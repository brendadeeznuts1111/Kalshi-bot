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
import { normalizeDimensionId, runDimension, DEFAULT_DIMENSION } from "./dimensions.ts";
import type { ResearchRun } from "./types.ts";
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

  const value = await fetcher();
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

export function saveRun(runId: string, generatedAt: string, payload: unknown): void {
  getDb().run(
    `INSERT INTO runs (run_id, generated_at, payload) VALUES (?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET generated_at = excluded.generated_at, payload = excluded.payload`,
    [runId, generatedAt, JSON.stringify(payload)],
  );
}

export function isResearchRun(value: unknown): value is ResearchRun {
  if (!value || typeof value !== "object") return false;
  const run = value as ResearchRun;
  return Array.isArray(run.scored) && Array.isArray(run.shortlist) && typeof run.runId === "string";
}

/** Pipeline runs use ISO timestamps as runId; test fixtures use named ids or far-future years. */
const PRODUCTION_RUN_ID = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

export function isProductionRunId(runId: string): boolean {
  if (!PRODUCTION_RUN_ID.test(runId)) return false;
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

/** Pipeline run suitable for “latest” resolution (excludes far-future test fixtures). */
export function isEligibleProductionRun(run: ResearchRun): boolean {
  if (!isProductionRunId(run.runId)) return false;
  const generatedAtMs = Date.parse(run.generatedAt);
  return Number.isFinite(generatedAtMs) && generatedAtMs <= Date.now() + 86_400_000;
}

export function loadResearchRun(options?: {
  runId?: string;
  dimension?: string;
}): ResearchRun | null {
  const runId = options?.runId?.trim();
  if (runId) return loadRunFromDb(runId);
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
    if (runDimension(parsed) !== targetDimension) continue;
    if (isEligibleProductionRun(parsed)) return parsed;
    fallback ??= parsed;
  }
  return options?.includeFixtures ? fallback : null;
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
