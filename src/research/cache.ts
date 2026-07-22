// @see https://bun.com/docs/runtime/sqlite#load-via-es-module-import
// @see https://bun.com/docs/runtime/hashing#bun-hash
/**
 * Disk cache + run history in `research/cache/cache.db` (gitignored).
 *
 * - **api_cache** — keyed by `Bun.hash(repo:endpoint:pushed_at)`; TTL on `expires_at`
 * - **runs** — full `ResearchRun` JSON for run-to-run diff (`diff.ts`)
 *
 * Inspect uses bounded concurrency (`pool.ts` + `DEFAULT_INSPECT_CONCURRENCY`).
 * JSON dumps go to gitignored `research/outputs/`; committed reports are `latest.md` + `latest.diff.md`.
 */
import { Database, type Statement } from "bun:sqlite";
import { awaitSettled } from "./bun-settle.ts";
import {
  inferDiscoverGateFromSearchQueries,
  resolveDiscoverGate,
} from "./discover-gate.ts";
import { isGitHubRateLimitError, isGitHubRateLimitTripped, throwCacheMissIfTripped } from "./github-errors.ts";
import { recordCacheStat } from "./github-cache-stats.ts";
import { normalizeDimensionId, runDimension, DEFAULT_DIMENSION } from "./dimensions.ts";
import type { ResearchRun, InspectionSignals } from "./types.ts";
import type { GhSearchRepo } from "./github-search.ts";
import { CACHE_DB, CACHE_DIR, joinPath } from "./paths.ts";

export { CACHE_DIR, OUTPUT_DIR, REPORT_DIR, RESEARCH_ROOT, CACHE_DB } from "./paths.ts";

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let db: Database | null = null;
let openDbPath: string | null = null;

/** Operator DB, or `RESEARCH_CACHE_DB` override (tests use `:memory:`). */
export function resolveCacheDbPath(): string {
  const override = Bun.env.RESEARCH_CACHE_DB?.trim();
  return override && override.length > 0 ? override : CACHE_DB;
}

/** Close the shared connection so the next call reopens (path may have changed). */
export function resetCacheDbConnection(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  db = null;
  stmts = null;
  openDbPath = null;
}

type CacheStatements = {
  apiGetFresh: Statement;
  apiGetAny: Statement;
  apiUpsert: Statement;
  inspectGet: Statement;
  inspectUpsert: Statement;
  inspectLatest: Statement;
  inspectCountRepos: Statement;
  inspectHasRepo: Statement;
  searchGet: Statement;
  searchUpsert: Statement;
  searchHasAny: Statement;
  searchHasQueryContaining: Statement;
  searchListQueries: Statement;
  runUpsert: Statement;
  runGet: Statement;
  runDelete: Statement;
  runsRecent: Statement;
  runIds: Statement;
  runSummaries: Statement;
  apiSearchPayloads: Statement;
};

/** Over-fetch window for post-filter fixture starvation (same idea as listRunSummaries). */
const RUNS_RECENT_FETCH_CAP = 500;

/** Latest/prior resolution always scans the full over-fetch window (fixtures sort first). */
function loadRecentRunRows(): Array<{ run_id: string; payload: string }> {
  return getStmts().runsRecent.all(RUNS_RECENT_FETCH_CAP) as Array<{ run_id: string; payload: string }>;
}

let stmts: CacheStatements | null = null;

function prepareStatements(conn: Database): CacheStatements {
  return {
    apiGetFresh: conn.query("SELECT payload FROM api_cache WHERE hash = ? AND expires_at > ?"),
    apiGetAny: conn.query("SELECT payload FROM api_cache WHERE hash = ?"),
    apiUpsert: conn.query(
      `INSERT INTO api_cache (hash, repo, endpoint, pushed_at, payload, created_at, expires_at)
       VALUES ($hash, $repo, $endpoint, $pushedAt, $payload, $createdAt, $expiresAt)
       ON CONFLICT(hash) DO UPDATE SET
         payload = excluded.payload,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
    ),
    inspectGet: conn.query("SELECT payload FROM inspect_cache WHERE repo = ? AND pushed_at = ?"),
    inspectUpsert: conn.query(
      `INSERT INTO inspect_cache (repo, pushed_at, payload, created_at)
       VALUES ($repo, $pushedAt, $payload, $createdAt)
       ON CONFLICT(repo, pushed_at) DO UPDATE SET
         payload = excluded.payload,
         created_at = excluded.created_at`,
    ),
    inspectLatest: conn.query(
      "SELECT payload FROM inspect_cache WHERE repo = ? ORDER BY created_at DESC LIMIT 1",
    ),
    inspectCountRepos: conn.query("SELECT COUNT(DISTINCT repo) AS n FROM inspect_cache"),
    inspectHasRepo: conn.query("SELECT 1 AS ok FROM inspect_cache WHERE repo = ? LIMIT 1"),
    searchGet: conn.query("SELECT query, etag, payload FROM search_cache WHERE query_key = ?"),
    searchUpsert: conn.query(
      `INSERT INTO search_cache (query_key, query, etag, payload, created_at)
       VALUES ($queryKey, $query, $etag, $payload, $createdAt)
       ON CONFLICT(query_key) DO UPDATE SET
         query = excluded.query,
         etag = excluded.etag,
         payload = excluded.payload,
         created_at = excluded.created_at`,
    ),
    searchHasAny: conn.query("SELECT 1 AS ok FROM search_cache LIMIT 1"),
    /** Loose match: dimension bare query appears in a stored GitHub search string. */
    searchHasQueryContaining: conn.query(
      "SELECT 1 AS ok FROM search_cache WHERE lower(query) LIKE ? ESCAPE '\\' LIMIT 1",
    ),
    searchListQueries: conn.query("SELECT query FROM search_cache"),
    runUpsert: conn.query(
      `INSERT INTO runs (run_id, generated_at, payload) VALUES ($runId, $generatedAt, $payload)
       ON CONFLICT(run_id) DO UPDATE SET generated_at = excluded.generated_at, payload = excluded.payload`,
    ),
    runGet: conn.query("SELECT payload FROM runs WHERE run_id = ?"),
    runDelete: conn.query("DELETE FROM runs WHERE run_id = ?"),
    runsRecent: conn.query(
      "SELECT run_id, payload FROM runs ORDER BY generated_at DESC LIMIT ?",
    ),
    runIds: conn.query("SELECT run_id FROM runs ORDER BY generated_at DESC"),
    runSummaries: conn.query(
      "SELECT run_id, generated_at, payload FROM runs ORDER BY generated_at DESC LIMIT ?",
    ),
    apiSearchPayloads: conn.query(
      `SELECT repo, pushed_at, payload FROM api_cache
       WHERE endpoint = ? AND payload LIKE ? AND expires_at > ?`,
    ),
  };
}

function getDb(): Database {
  const path = resolveCacheDbPath();
  if (db && openDbPath === path) return db;
  if (db) resetCacheDbConnection();

  db = new Database(path, { create: true });
  openDbPath = path;
  // @see https://bun.com/docs/runtime/sqlite — :memory: is ephemeral; WAL is for file DBs.
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_cache (
      hash TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      pushed_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_cache_repo_endpoint ON api_cache(repo, endpoint);
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inspect_cache (
      repo TEXT NOT NULL,
      pushed_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (repo, pushed_at)
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      query_key TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      etag TEXT,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  stmts = prepareStatements(db);
  return db;
}

function getStmts(): CacheStatements {
  if (!stmts) getDb();
  return stmts!;
}

export function cacheHash(repo: string, endpoint: string, pushedAt: string): string {
  return String(Bun.hash(`${repo}:${endpoint}:${pushedAt}`));
}

export async function withCache<T>(
  repo: string,
  pushedAt: string,
  endpoint: string,
  fetcher: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS,
): Promise<T> {
  const hash = cacheHash(repo, pushedAt, endpoint);
  const now = Date.now();
  const q = getStmts();

  const row = q.apiGetFresh.get(hash, now) as { payload: string } | null;

  if (row) {
    return JSON.parse(row.payload) as T;
  }

  const staleRow = q.apiGetAny.get(hash) as { payload: string } | null;

  if (staleRow && isGitHubRateLimitTripped()) {
    recordCacheStat("apiDegraded");
    console.error(`[cache] degraded api_cache hit: ${repo}:${endpoint}`);
    return JSON.parse(staleRow.payload) as T;
  }

  throwCacheMissIfTripped("api", `${repo}:${endpoint}`);

  let value: T;
  try {
    value = await awaitSettled(fetcher());
  } catch (err) {
    if (isGitHubRateLimitError(err)) throw err;
    throw err;
  }

  const payload = JSON.stringify(value);
  const expiresAt = now + ttlMs;

  q.apiUpsert.run({
    $hash: hash,
    $repo: repo,
    $endpoint: endpoint,
    $pushedAt: pushedAt,
    $payload: payload,
    $createdAt: now,
    $expiresAt: expiresAt,
  });

  return value;
}

/** Whole-repo inspect snapshot — skips live GitHub when `pushed_at` unchanged. */
export function loadInspectCache(repo: string, pushedAt: string): InspectionSignals | null {
  const row = getStmts().inspectGet.get(repo, pushedAt) as { payload: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as InspectionSignals;
  } catch {
    return null;
  }
}

export function saveInspectCache(repo: string, pushedAt: string, signals: InspectionSignals): void {
  getStmts().inspectUpsert.run({
    $repo: repo,
    $pushedAt: pushedAt,
    $payload: JSON.stringify(signals),
    $createdAt: Date.now(),
  });
}

/** Most recent inspect snapshot for a repo (any pushed_at) — stale fallback under rate limit. */
export function loadLatestInspectCache(repo: string): InspectionSignals | null {
  const row = getStmts().inspectLatest.get(repo) as { payload: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as InspectionSignals;
  } catch {
    return null;
  }
}

/** Distinct repos with inspect snapshots (any dimension / run). */
export function countInspectCacheRepos(): number {
  const row = getStmts().inspectCountRepos.get() as { n: number } | null;
  return row?.n ?? 0;
}

export function hasInspectCacheForRepo(repo: string): boolean {
  const row = getStmts().inspectHasRepo.get(repo) as { ok: number } | null;
  return row !== null;
}

export function hasAnySearchCache(): boolean {
  const row = getStmts().searchHasAny.get() as { ok: number } | null;
  return row !== null;
}

export function hasSearchCacheForQuery(query: string): boolean {
  return loadSearchCache(searchQueryKey(query)) !== null;
}

/**
 * True when any search_cache row's query string contains `bareQuery`
 * (case-insensitive). Survives pushed:/stars: qualifier drift vs exact hash.
 */
export function hasSearchCacheCoveringBareQuery(bareQuery: string): boolean {
  const trimmed = bareQuery.trim().toLowerCase();
  if (!trimmed) return false;
  const escaped = trimmed
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
  const row = getStmts().searchHasQueryContaining.get(`%${escaped}%`) as {
    ok: number;
  } | null;
  return row !== null;
}

/** All stored GitHub search strings (for qualifier-normalized coverage). */
export function listSearchCacheQueries(): string[] {
  const rows = getStmts().searchListQueries.all() as Array<{ query: string }>;
  return rows.map((r) => r.query);
}

export function searchQueryKey(query: string): string {
  return String(Bun.hash(query));
}

export function loadSearchCache(
  queryKey: string,
): { query: string; etag: string | null; payload: GhSearchRepo[] } | null {
  const row = getStmts().searchGet.get(queryKey) as {
    query: string;
    etag: string | null;
    payload: string;
  } | null;
  if (!row) return null;
  try {
    return {
      query: row.query,
      etag: row.etag,
      payload: JSON.parse(row.payload) as GhSearchRepo[],
    };
  } catch {
    return null;
  }
}

export function saveSearchCache(
  queryKey: string,
  query: string,
  etag: string | null,
  payload: GhSearchRepo[],
): void {
  getStmts().searchUpsert.run({
    $queryKey: queryKey,
    $query: query,
    $etag: etag,
    $payload: JSON.stringify(payload),
    $createdAt: Date.now(),
  });
}

export function searchCachedPayloads(
  endpoint: string,
  substring: string,
): Array<{ repo: string; pushedAt: string; payload: string }> {
  const needle = `%${substring}%`;
  const rows = getStmts().apiSearchPayloads.all(endpoint, needle, Date.now()) as Array<{
    repo: string;
    pushed_at: string;
    payload: string;
  }>;

  return rows.map((r) => ({ repo: r.repo, pushedAt: r.pushed_at, payload: r.payload }));
}

export function isFixtureRun(run: ResearchRun): boolean {
  // Explicit fixture / test source wins; never trust kind:"production" without eligibility.
  if (run.kind === "fixture" || run.source === "test") return true;
  return !isEligibleProductionRun(run);
}

export function isProductionRun(run: ResearchRun): boolean {
  return !isFixtureRun(run);
}

function stampDiscoverGate(run: ResearchRun): ResearchRun {
  if (run.config.discoverGate) return run;
  const apply = run.config.gate;
  if (!apply) return run;
  const fromMiss = run.discoveryMiss?.searchQueries?.length
    ? inferDiscoverGateFromSearchQueries(run.discoveryMiss.searchQueries, apply)
    : null;
  return {
    ...run,
    config: {
      ...run.config,
      discoverGate: fromMiss ?? resolveDiscoverGate(apply),
    },
  };
}

function stampRunKind(run: ResearchRun): ResearchRun {
  let stamped: ResearchRun;
  if (run.source === "test" || run.kind === "fixture") {
    stamped = {
      ...run,
      kind: "fixture",
      source: run.source === "test" ? "test" : run.source,
    };
  } else if (isEligibleProductionRun(run)) {
    stamped = {
      ...run,
      kind: "production",
      source: run.source ?? "pipeline",
    };
  } else {
    stamped = { ...run, kind: "fixture" };
  }
  return stampDiscoverGate(stamped);
}

export function saveRun(runId: string, generatedAt: string, payload: unknown): void {
  // Key is SSOT — payload.runId must match or operator views treat the row as corrupt.
  const record =
    isResearchRun(payload) ? stampRunKind({ ...payload, runId }) : payload;
  getStmts().runUpsert.run({
    $runId: runId,
    $generatedAt: generatedAt,
    $payload: JSON.stringify(record),
  });
}

/**
 * Rewrite runs missing `config.discoverGate` (miss searchQueries → else resolveDiscoverGate).
 * Returns updated run ids.
 */
export function backfillDiscoverGates(): string[] {
  const updated: string[] = [];
  for (const id of listRunIds()) {
    const row = getStmts().runGet.get(id) as { payload: string } | null;
    if (!row) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload) as unknown;
    } catch {
      continue;
    }
    if (!isResearchRun(parsed)) continue;
    if (parsed.config.discoverGate) continue;
    if (!parsed.config.gate) continue;
    saveRun(id, parsed.generatedAt, parsed);
    updated.push(id);
  }
  return updated;
}

/** Delete a run row by id (tests / fixture scrub). */
export function deleteRun(runId: string): void {
  getStmts().runDelete.run(runId);
}

/**
 * Remove fixture / ineligible / key-mismatch rows from the open cache DB.
 * Returns deleted run ids. Safe for operator cache after test pollution.
 */
export function purgeIneligibleRuns(): string[] {
  const ids = listRunIds();
  const deleted: string[] = [];
  for (const id of ids) {
    const row = getStmts().runGet.get(id) as { payload: string } | null;
    if (!row) {
      deleted.push(id);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload) as unknown;
    } catch {
      deleteRun(id);
      deleted.push(id);
      continue;
    }
    if (!isResearchRun(parsed) || parsed.runId !== id || isFixtureRun(parsed)) {
      deleteRun(id);
      deleted.push(id);
    }
  }
  return deleted;
}

export function isResearchRun(value: unknown): value is ResearchRun {
  if (!value || typeof value !== "object") return false;
  const run = value as ResearchRun;
  return Array.isArray(run.scored) && Array.isArray(run.shortlist) && typeof run.runId === "string";
}

/** Pipeline runs use ISO timestamps as runId; test fixtures use named ids or far-future years. */
const PRODUCTION_RUN_ID = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

/** Parse pipeline runId → UTC ms, or null when shape is not a timestamp id. */
export function runIdTimestampMs(runId: string): number | null {
  const m = PRODUCTION_RUN_ID.exec(runId);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function isProductionRunId(runId: string): boolean {
  const t = runIdTimestampMs(runId);
  if (t === null) return false;
  const year = Number(runId.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  const nowYear = new Date().getFullYear();
  // Reject test fixtures like 2099-… that match the ISO shape but are not real pipeline runs.
  return year >= 2020 && year <= nowYear + 1;
}

export function loadRunFromDb(runId: string): ResearchRun | null {
  const row = getStmts().runGet.get(runId) as { payload: string } | null;
  if (!row) return null;
  const parsed = JSON.parse(row.payload) as unknown;
  if (!isResearchRun(parsed)) return null;
  // Reject key/payload drift (e.g. legacy `cache-latest-winner` → ISO runId).
  if (parsed.runId !== runId) return null;
  return parsed;
}

const ELIGIBLE_FUTURE_SLACK_MS = 86_400_000;

/** Pipeline run suitable for “latest” resolution (excludes far-future test fixtures). */
export function isEligibleProductionRun(run: ResearchRun): boolean {
  if (!isProductionRunId(run.runId)) return false;
  const generatedAtMs = Date.parse(run.generatedAt);
  if (!Number.isFinite(generatedAtMs) || generatedAtMs > Date.now() + ELIGIBLE_FUTURE_SLACK_MS) {
    return false;
  }
  // Reject run ids whose embedded clock is far ahead (e.g. 2026-12-31… mid-year).
  const idMs = runIdTimestampMs(run.runId);
  if (idMs === null || idMs > Date.now() + ELIGIBLE_FUTURE_SLACK_MS) return false;
  return true;
}

export function loadResearchRun(options?: {
  runId?: string;
  dimension?: string;
  includeFixtures?: boolean;
}): ResearchRun | null {
  const runId = options?.runId?.trim();
  if (runId) {
    const run = loadRunFromDb(runId);
    if (!run) return null;
    if (!options?.includeFixtures && isFixtureRun(run)) return null;
    if (options?.dimension) {
      const target = normalizeDimensionId(options.dimension);
      if (runDimension(run) !== target) return null;
    }
    return run;
  }
  const dimension = normalizeDimensionId(options?.dimension ?? DEFAULT_DIMENSION);
  return loadLatestRunFromDb({ dimension });
}

export function loadLatestRunFromDb(options?: {
  includeFixtures?: boolean;
  dimension?: string;
}): ResearchRun | null {
  const targetDimension = normalizeDimensionId(options?.dimension);
  const rows = loadRecentRunRows();

  let fallback: ResearchRun | null = null;
  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed) || parsed.runId !== row.run_id) continue;
    if (isFixtureRun(parsed)) {
      if (options?.includeFixtures && runDimension(parsed) === targetDimension) {
        fallback ??= parsed;
      }
      continue;
    }
    if (runDimension(parsed) !== targetDimension) continue;
    if (isProductionRun(parsed)) return parsed;
    fallback ??= parsed;
  }
  return options?.includeFixtures ? fallback : null;
}

/** Latest eligible production run across all dimensions (operator “what ran last”). */
export function loadLatestProductionRunAnyDimension(): ResearchRun | null {
  const rows = loadRecentRunRows();

  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed) || parsed.runId !== row.run_id) continue;
    if (isFixtureRun(parsed)) continue;
    if (isProductionRun(parsed)) return parsed;
  }
  return null;
}

/** Latest production run for dimension strictly before `beforeRunId` (for diff baseline). */
export function loadPriorProductionRun(options: {
  dimension: string;
  beforeRunId?: string;
}): ResearchRun | null {
  const targetDimension = normalizeDimensionId(options.dimension);
  const rows = loadRecentRunRows();

  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed) || parsed.runId !== row.run_id) continue;
    if (isFixtureRun(parsed)) continue;
    if (runDimension(parsed) !== targetDimension) continue;
    if (options.beforeRunId && parsed.runId === options.beforeRunId) continue;
    if (isProductionRun(parsed)) return parsed;
  }
  return null;
}

/** Latest eligible production run from any dimension other than `dimension`. */
export function loadFallbackRunFromDb(options: { dimension: string }): ResearchRun | null {
  const targetDimension = normalizeDimensionId(options.dimension);
  const rows = loadRecentRunRows();

  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed) || parsed.runId !== row.run_id) continue;
    if (isFixtureRun(parsed)) continue;
    if (runDimension(parsed) === targetDimension) continue;
    if (isProductionRun(parsed)) return parsed;
  }
  return null;
}

export function listRunIds(): string[] {
  const rows = getStmts().runIds.all() as Array<{ run_id: string }>;
  return rows.map((r) => r.run_id);
}

export type RunSummary = {
  runId: string;
  generatedAt: string;
  dimension: string;
  discovered: number;
  gated: number;
  inspected: number;
  shortlist: number;
};

export function listRunSummaries(limit = 20): RunSummary[] {
  // Over-fetch: fixture rows (often far-future generated_at) sort first and must not
  // starve the post-filter limit.
  const fetchLimit = Math.min(Math.max(limit * 8, 80), 500);
  const rows = getStmts().runSummaries.all(fetchLimit) as Array<{
    run_id: string;
    generated_at: string;
    payload: string;
  }>;

  const out: RunSummary[] = [];
  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed)) continue;
    if (parsed.runId !== row.run_id) continue;
    if (isFixtureRun(parsed)) continue;
    out.push({
      runId: row.run_id,
      generatedAt: row.generated_at,
      dimension: runDimension(parsed),
      discovered: parsed.stats.discovered,
      gated: parsed.stats.gated,
      inspected: parsed.stats.inspected,
      shortlist: parsed.stats.shortlist,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Ensure cache directory exists for cache.db (Bun creates file, not always parent). */
export async function ensureCacheDir(): Promise<void> {
  await Bun.write(joinPath(CACHE_DIR, ".keep"), "");
}
