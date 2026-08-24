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

const ROOT = join(import.meta.dir, '..');
const flags = Bun.argv.slice(2);
const blogFlag = flags.find((f) => f.startsWith('--blog='));
const reportFlag = flags.find((f) => f.startsWith('--report='));

const { coverage, newUnmapped } = await runBlogMap({
  root: ROOT,
  ...(blogFlag ? { blogUrl: blogFlag.slice('--blog='.length) } : {}),
  ...(reportFlag ? { reportPath: reportFlag.slice('--report='.length) } : {}),
  ...(flags.includes('--offline') ? { offline: true } : {}),
});

console.log('blog-map: coverage ' + Math.round(coverage * 100) + '% · ' + newUnmapped + ' new unmapped sub-header(s)');
console.log('state:  .data/blog-map-state.json · report: research/outputs/blog-map.md');
process.exit(newUnmapped === 0 ? 0 : 1);