#!/usr/bin/env bun
/**
 * Stamp config.discoverGate on runs that lack it (operator cache.db).
 * Usage: bun tools/backfill-discover-gates.ts
 */
import {
  backfillDiscoverGates,
  resetCacheDbConnection,
  resolveCacheDbPath,
} from "../src/research/cache.ts";

delete Bun.env.RESEARCH_CACHE_DB;
resetCacheDbConnection();
const updated = backfillDiscoverGates();
console.log(`Backfilled discoverGate on ${updated.length} run(s) in ${resolveCacheDbPath()}`);
if (updated.length > 0 && updated.length <= 40) {
  for (const id of updated) console.log(`  - ${id}`);
}
