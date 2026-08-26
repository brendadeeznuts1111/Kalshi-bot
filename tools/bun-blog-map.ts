#!/usr/bin/env bun
/**
 * `bun run bun:blog-map` — the blog → repo mapping TRACKER.
 *
 * Fetches the Bun release blog, extracts the anchor/sub-header tree under
 * #faster #bun-build #bun-test #bun-install #what-s-new, and diffs it
 * against the registry (.data/blog-map.json). Writes the state
 * (.data/blog-map-state.json) + a markdown report, then exits:
 *   0 — coverage complete (no new unmapped sub-headers)
 *   1 — CONTRACT VIOLATION: the blog added sub-headers we have not mapped
 *
 * Flags: --blog=<url> · --report=<path> · --offline
 *
 * Shared implementation: src/lib/blog-map-run.ts (also used by the daily
 * cron in serve.ts). The signal pipeline's "mapping" channel reads the
 * state file (AGENT-PITFALLS §31).
 */
import { join } from 'node:path';
import { runBlogMap } from '../src/lib/blog-map-run.ts';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dir, '..');
const { values: bmv } = parseArgs({ args: Bun.argv.slice(2), options: { blog: { type: 'string' }, report: { type: 'string' }, offline: { type: 'boolean' } }, strict: false, allowPositionals: true });

const { coverage, newUnmapped, curation } = await runBlogMap({
  root: ROOT,
  ...(typeof bmv.blog === 'string' ? { blogUrl: bmv.blog } : {}),
  ...(typeof bmv.report === 'string' ? { reportPath: bmv.report } : {}),
  ...(bmv.offline === true ? { offline: true } : {}),
});

console.log('blog-map: coverage ' + Math.round(coverage * 100) + '% · curation ' + Math.round((curation ?? 0) * 100) + '% · ' + newUnmapped + ' new unmapped heading(s)');
console.log('state:  .data/blog-map-state.json · report: research/outputs/blog-map.md');
process.exit(newUnmapped === 0 ? 0 : 1);