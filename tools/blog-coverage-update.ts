#!/usr/bin/env bun
/**
 * blog:coverage-update — fold the blog→demo coverage map into the registry.
 * For every heading whose code blocks map to an existing demo route/function,
 * set the registry entry's mappedTo (only where currently "NOT mapped") so all
 * behaviors are documented in demos. Existing curated mappings are preserved.
 * Output: .data/blog-map.json (tracked registry) + a summary.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const COVERAGE_PATH = join(ROOT, 'research/outputs/blog-coverage-map.json');
const REGISTRY_PATH = join(ROOT, '.data/blog-map.json');

if (!existsSync(COVERAGE_PATH)) {
  console.error('run blog:coverage first (bun tools/blog-coverage-map.ts)');
  process.exit(1);
}

const coverage = JSON.parse(readFileSync(COVERAGE_PATH, 'utf8'));
const registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));

// most common demo per heading among covered blocks
const headingDemo = new Map<string, string>();
for (const r of coverage.rows) {
  if (!r.demo) continue;
  if (!headingDemo.has(r.headingId)) headingDemo.set(r.headingId, r.demo);
}

let updated = 0;
let preserved = 0;
let stillUnmapped = 0;
for (const e of registry.entries) {
  const demo = headingDemo.get(e.id);
  if (!demo) continue;
  if (e.mappedTo && e.mappedTo !== 'NOT mapped') {
    preserved++; // curated mapping wins
    continue;
  }
  e.mappedTo = demo;
  e.status = 'note';
  e.layer = e.layer && e.layer !== '\u2014' ? e.layer : 'demo route/function';
  updated++;
}
for (const e of registry.entries) {
  if (!e.mappedTo || e.mappedTo === 'NOT mapped') stillUnmapped++;
}

writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
const total = registry.entries.length;
console.log('blog:coverage-update — registry ' + total + ' entries · ' + updated + ' newly mapped to demo routes/functions · ' + preserved + ' curated mappings preserved · ' + stillUnmapped + ' still unmapped (' + Math.round(((total - stillUnmapped) / total) * 100) + '% curated)');
