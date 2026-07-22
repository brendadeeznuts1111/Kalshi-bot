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
import { Database } from "bun:sqlite";
import { awaitSettled } from "./bun-settle.ts";
import { isGitHubRateLimitError, isGitHubRateLimitTripped, throwCacheMissIfTripped } from "./github-errors.ts";
import { recordCacheStat } from "./github-cache-stats.ts";
import { normalizeDimensionId, runDimension, DEFAULT_DIMENSION } from "./dimensions.ts";
import type { ResearchRun, InspectionSignals } from "./types.ts";
import type { GhSearchRepo } from "./github-search.ts";
import { CACHE_DB, CACHE_DIR, joinPath } from "./paths.ts";

export { CACHE_DIR, OUTPUT_DIR, REPORT_DIR, RESEARCH_ROOT, CACHE_DB } from "./paths.ts";

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let db: Database | null = null;

function getDb(): Database {
  if (db) return db;
  db = new Database(CACHE_DB, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
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
  return db;
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
  const conn = getDb();

  const row = conn
    .query("SELECT payload FROM api_cache WHERE hash = ? AND expires_at > ?")
    .get(hash, now) as { payload: string } | null;

  if (row) {
    return JSON.parse(row.payload) as T;
  }

  const staleRow = conn
    .query("SELECT payload FROM api_cache WHERE hash = ?")
    .get(hash) as { payload: string } | null;

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

  conn.run(
    `INSERT INTO api_cache (hash, repo, endpoint, pushed_at, payload, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET
       payload = excluded.payload,
       created_at = excluded.created_at,
       expires_at = excluded.expires_at`,
    [hash, repo, endpoint, pushedAt, payload, now, expiresAt],
  );

  return value;
}

/** Whole-repo inspect snapshot — skips all gh calls when `pushed_at` unchanged. */
export function loadInspectCache(repo: string, pushedAt: string): InspectionSignals | null {
  const row = getDb()
    .query("SELECT payload FROM inspect_cache WHERE repo = ? AND pushed_at = ?")
    .get(repo, pushedAt) as { payload: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as InspectionSignals;
  } catch {
    return null;
  }
}

export function saveInspectCache(repo: string, pushedAt: string, signals: InspectionSignals): void {
  getDb().run(
    `INSERT INTO inspect_cache (repo, pushed_at, payload, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo, pushed_at) DO UPDATE SET
       payload = excluded.payload,
       created_at = excluded.created_at`,
    [repo, pushedAt, JSON.stringify(signals), Date.now()],
  );
}

/** Most recent inspect snapshot for a repo (any pushed_at) — stale fallback under rate limit. */
export function loadLatestInspectCache(repo: string): InspectionSignals | null {
  const row = getDb()
    .query("SELECT payload FROM inspect_cache WHERE repo = ? ORDER BY created_at DESC LIMIT 1")
    .get(repo) as { payload: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as InspectionSignals;
  } catch {
    return null;
  }
}

/** Distinct repos with inspect snapshots (any dimension / run). */
export function countInspectCacheRepos(): number {
  const row = getDb()
    .query("SELECT COUNT(DISTINCT repo) AS n FROM inspect_cache")
    .get() as { n: number } | null;
  return row?.n ?? 0;
}

export function hasInspectCacheForRepo(repo: string): boolean {
  const row = getDb().query("SELECT 1 AS ok FROM inspect_cache WHERE repo = ? LIMIT 1").get(repo) as
    | { ok: number }
    | null;
  return row !== null;
}

export function hasAnySearchCache(): boolean {
  const row = getDb().query("SELECT 1 AS ok FROM search_cache LIMIT 1").get() as { ok: number } | null;
  return row !== null;
}

export function hasSearchCacheForQuery(query: string): boolean {
  return loadSearchCache(searchQueryKey(query)) !== null;
}

export function searchQueryKey(query: string): string {
  return String(Bun.hash(query));
}

export function loadSearchCache(
  queryKey: string,
): { query: string; etag: string | null; payload: GhSearchRepo[] } | null {
  const row = getDb()
    .query("SELECT query, etag, payload FROM search_cache WHERE query_key = ?")
    .get(queryKey) as { query: string; etag: string | null; payload: string } | null;
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
  getDb().run(
    `INSERT INTO search_cache (query_key, query, etag, payload, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(query_key) DO UPDATE SET
       query = excluded.query,
       etag = excluded.etag,
       payload = excluded.payload,
       created_at = excluded.created_at`,
    [queryKey, query, etag, JSON.stringify(payload), Date.now()],
  );
}

export function searchCachedPayloads(
  endpoint: string,
  substring: string,
): Array<{ repo: string; pushedAt: string; payload: string }> {
  const conn = getDb();
  const needle = `%${substring}%`;
  const rows = conn
    .query(
      `SELECT repo, pushed_at, payload FROM api_cache
       WHERE endpoint = ? AND payload LIKE ? AND expires_at > ?`,
    )
    .all(endpoint, needle, Date.now()) as Array<{ repo: string; pushed_at: string; payload: string }>;

  return rows.map((r) => ({ repo: r.repo, pushedAt: r.pushed_at, payload: r.payload }));
}

export function isFixtureRun(run: ResearchRun): boolean {
  if (run.kind === "fixture") return true;
  if (!isProductionRunId(run.runId)) return true;
  if (run.kind === "production") return false;
  return !isEligibleProductionRun(run);
}

export function isProductionRun(run: ResearchRun): boolean {
  return !isFixtureRun(run);
}

function stampRunKind(run: ResearchRun): ResearchRun {
  if (run.kind) return run;
  return {
    ...run,
    kind: isEligibleProductionRun(run) ? "production" : "fixture",
  };
}

export function saveRun(runId: string, generatedAt: string, payload: unknown): void {
  const record =
    isResearchRun(payload) ? stampRunKind(payload) : payload;
  getDb().run(
    `INSERT INTO runs (run_id, generated_at, payload) VALUES (?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET generated_at = excluded.generated_at, payload = excluded.payload`,
    [runId, generatedAt, JSON.stringify(record)],
  );
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
  const row = getDb().query("SELECT payload FROM runs WHERE run_id = ?").get(runId) as
    | { payload: string }
    | null;
  if (!row) return null;
  const parsed = JSON.parse(row.payload) as unknown;
  return isResearchRun(parsed) ? parsed : null;
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
  const rows = getDb()
    .query("SELECT payload FROM runs ORDER BY generated_at DESC LIMIT 50")
    .all() as Array<{ payload: string }>;

  let fallback: ResearchRun | null = null;
  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed)) continue;
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
  const rows = getDb()
    .query("SELECT payload FROM runs ORDER BY generated_at DESC LIMIT 50")
    .all() as Array<{ payload: string }>;

  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed)) continue;
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
  const rows = getDb()
    .query("SELECT payload FROM runs ORDER BY generated_at DESC LIMIT 50")
    .all() as Array<{ payload: string }>;

  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed)) continue;
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
  const rows = getDb()
    .query("SELECT payload FROM runs ORDER BY generated_at DESC LIMIT 50")
    .all() as Array<{ payload: string }>;

  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed)) continue;
    if (isFixtureRun(parsed)) continue;
    if (runDimension(parsed) === targetDimension) continue;
    if (isProductionRun(parsed)) return parsed;
  }
  return null;
}

export function listRunIds(): string[] {
  const rows = getDb()
    .query("SELECT run_id FROM runs ORDER BY generated_at DESC")
    .all() as Array<{ run_id: string }>;
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
  const rows = getDb()
    .query("SELECT run_id, generated_at, payload FROM runs ORDER BY generated_at DESC LIMIT ?")
    .all(limit) as Array<{ run_id: string; generated_at: string; payload: string }>;

  const out: RunSummary[] = [];
  for (const row of rows) {
    const parsed = JSON.parse(row.payload) as unknown;
    if (!isResearchRun(parsed)) continue;
    if (isFixtureRun(parsed)) continue;
    out.push({
      runId: row.run_id,
      generatedAt: row.generated_at,
      dimension: runDimension(parsed),
      ...parsed.stats,
    });
  }
  return out;
}

/** Ensure cache directory exists for cache.db (Bun creates file, not always parent). */
export async function ensureCacheDir(): Promise<void> {
  await Bun.write(joinPath(CACHE_DIR, ".keep"), "");
}
