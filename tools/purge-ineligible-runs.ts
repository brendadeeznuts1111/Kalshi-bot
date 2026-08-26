#!/usr/bin/env bun
/**
 * Scrub fixture / key-mismatch / synthetic-shortlist rows from operator cache.db.
 *
 * Usage:
 *   bun tools/purge-ineligible-runs.ts
 *   bun tools/purge-ineligible-runs.ts --purge-test-inspect
 *
 * `--purge-test-inspect` also deletes inspect_cache rows with harness repo keys
 * (`cross-dim-*`). Does not touch real owner/name inspect rows.
 */
import { purgeIneligibleRuns, resetCacheDbConnection, resolveCacheDbPath } from "../src/research/cache.ts";
import { parseArgs } from "node:util";

delete Bun.env.RESEARCH_CACHE_DB;
resetCacheDbConnection();

const { values: pirv } = parseArgs({ args: Bun.argv.slice(2), options: { 'purge-test-inspect': { type: 'boolean' } }, strict: false, allowPositionals: true });
const purgeTestInspect = pirv['purge-test-inspect'] === true;
const deleted = purgeIneligibleRuns({ purgeTestInspect });
console.log(`Purged ${deleted.length} run(s) from ${resolveCacheDbPath()}`);
if (purgeTestInspect) {
  console.log("Also purged inspect_cache rows matching cross-dim-*");
}
if (deleted.length > 0 && deleted.length <= 40) {
  for (const id of deleted) console.log(`  - ${id}`);
} else if (deleted.length > 40) {
  for (const id of deleted.slice(0, 20)) console.log(`  - ${id}`);
  console.log(`  … and ${deleted.length - 20} more`);
}
