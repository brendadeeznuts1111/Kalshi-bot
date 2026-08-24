/**
 * blog-map-run.ts — the runnable blog→repo mapping tracker body.
 * Shared by the CLI (tools/bun-blog-map.ts) and the daily cron (serve.ts
 * registerBlogMapCron) so both use one implementation (AGENT-PITFALLS §31).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { diffBlogMap, mappingReport, type BlogMapRegistry, type BlogMapState } from './blog-map.ts';
import { probeFetch } from './probe-fetch.ts';

export type BlogMapRunOptions = {
  root?: string;
  blogUrl?: string;
  reportPath?: string;
  offline?: boolean;
};

export async function runBlogMap(options: BlogMapRunOptions = {}): Promise<{ coverage: number; newUnmapped: number }> {
  const root = options.root ?? join(import.meta.dir, '..', '..');
  const REGISTRY_PATH = join(root, '.data/blog-map.json');
  const STATE_PATH = join(root, '.data/blog-map-state.json');
  const CACHE_PATH = join(root, 'research/cache/bun-blog.html');
  const blogUrl = options.blogUrl ?? 'https://bun.sh/blog/bun-v1.4';
  const reportPath = options.reportPath ?? join(root, 'research/outputs/blog-map.md');

  const registry: BlogMapRegistry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));

  let html: string;
  if (options.offline && existsSync(CACHE_PATH)) {
    html = readFileSync(CACHE_PATH, 'utf8');
  } else {
    // probeFetch: bounded timeout + retry + UA (bare fetch hung on a dead
    // host — §57). Null on failure -> the cache-less path stays honest.
    const res = await probeFetch(blogUrl);
    if (!res) return { coverage: 0, newUnmapped: -1 }; // unreachable
    html = await res.text();
    mkdirSync(join(root, 'research/cache'), { recursive: true });
    writeFileSync(CACHE_PATH, html);
  }

  const diff = diffBlogMap(html, registry.entries);
  const now = new Date().toISOString();
  const state: BlogMapState = {
    lastChecked: now,
    coverage: diff.coverage,
    matched: diff.matched.length,
    newUnmapped: diff.newUnmapped.length,
    missing: diff.missing,
    newUnmappedIds: diff.newUnmapped.map((u) => u.id),
  };
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
  const report = mappingReport(diff, now);
  mkdirSync(join(reportPath, '..'), { recursive: true });
  writeFileSync(reportPath, report);
  return { coverage: diff.coverage, newUnmapped: diff.newUnmapped.length };
}