#!/usr/bin/env bun
/**
 * Scrub fixture / key-mismatch / test-source rows from operator cache.db.
 * Usage: bun tools/purge-ineligible-runs.ts
 */
import { purgeIneligibleRuns, resetCacheDbConnection, resolveCacheDbPath } from "../src/research/cache.ts";

delete Bun.env.RESEARCH_CACHE_DB;
resetCacheDbConnection();
const deleted = purgeIneligibleRuns();
console.log(`Purged ${deleted.length} run(s) from ${resolveCacheDbPath()}`);
if (deleted.length > 0 && deleted.length <= 40) {
  for (const id of deleted) console.log(`  - ${id}`);
}
