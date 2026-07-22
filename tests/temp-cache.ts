// @see https://bun.com/docs/runtime/sqlite#load-via-es-module-import
// @see https://bun.com/docs/runtime/utils#bun-env
import { resetCacheDbConnection, resolveCacheDbPath } from "../src/research/cache.ts";

let active = false;
let previousEnv: string | undefined;

/**
 * Point cache at a fresh in-memory sqlite DB (`RESEARCH_CACHE_DB=:memory:`).
 * Pair with {@link exitTempCache} in beforeAll/afterAll, or use {@link withTempCache}.
 *
 * Prefer `bun test --isolate` so file-level env swaps do not race across files.
 */
export async function enterTempCache(): Promise<string> {
  if (active) {
    throw new Error("temp cache already active — call exitTempCache() first");
  }
  previousEnv = Bun.env.RESEARCH_CACHE_DB;
  active = true;
  Bun.env.RESEARCH_CACHE_DB = ":memory:";
  resetCacheDbConnection();
  return ":memory:";
}

/** Restore prior `RESEARCH_CACHE_DB` and drop the in-memory connection. */
export function exitTempCache(): void {
  resetCacheDbConnection();
  if (previousEnv === undefined) delete Bun.env.RESEARCH_CACHE_DB;
  else Bun.env.RESEARCH_CACHE_DB = previousEnv;
  previousEnv = undefined;
  active = false;
  resetCacheDbConnection();
}

/**
 * Run `fn` against an isolated in-memory sqlite DB.
 * Restores the previous env + connection afterward. Does not touch operator cache.db.
 */
export async function withTempCache<T>(fn: () => T | Promise<T>): Promise<T> {
  await enterTempCache();
  try {
    return await fn();
  } finally {
    exitTempCache();
  }
}

/** Assert helper — current connection path (after env applied). */
export function currentTestCacheDbPath(): string {
  return resolveCacheDbPath();
}
