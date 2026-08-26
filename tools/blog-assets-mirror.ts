#!/usr/bin/env bun
/**
 * blog:assets - mirror the tracked Bun blog-map data into public/blog/ so the
 * dev server can serve it offline (maintainability: one regenerable copy).
 *
 * Sources (all deterministic, no timestamps in output):
 *   .data/blog-map.json        - blog map entries (tracked)
 *   .data/blog-map-state.json  - coverage state (tracked)
 *   research/outputs/blog-map.md + bun-release-1.4.md - reports when present
 *
 * Output: public/blog/{index.json, blog-map.json, blog-map-state.json, *.md}.
 * The verify:contracts gate (gate #58) runs `blog:assets --check`: missing
 * mirror is bootstrapped, existing-but-different fails with a regen pointer.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { sha256Hex, fromBunFile } from '../src/lib/artifact.ts';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const DATA = join(ROOT, '.data');
const OUT = join(ROOT, 'public', 'blog');
const REPORTS = join(ROOT, 'research', 'outputs');

const SOURCES: Array<[string, string]> = [
  // NOTE: blog-map-state.json is EXCLUDED - it carries a lastChecked timestamp
  // (non-deterministic; would drift the mirror every bun:blog-map run).
  [join(DATA, 'blog-map.json'), 'blog-map.json'],
  [join(REPORTS, 'blog-map.md'), 'blog-map.md'],
  [join(REPORTS, 'bun-release-1.4.md'), 'bun-release-1.4.md'],
];

export function generate(): { files: Record<string, string>; manifest: Record<string, unknown> } {
  // The report embeds a fresh 'Checked <ISO timestamp>' line on every
  // bun:blog-map run - normalize it out so the mirror is byte-stable.
  const normalize = (name: string, text: string): string =>
    name.endsWith('.md') ? text.replace(/Checked \d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'Checked (mirrored)') : text;
  const files: Record<string, string> = {};
  const copied: string[] = [];
  for (const [src, name] of SOURCES) {
    if (existsSync(src)) { files[name] = normalize(name, readFileSync(src, 'utf8')); copied.push(name); }
  }
  type Entry = {
    id: string;
    level: string;
    section: string;
    status: string;
    badges: Array<{ verb: string; version: string; href: string; tone: string }>;
  };
  const blogMap = JSON.parse(files['blog-map.json'] ?? '{}') as { blogUrl?: string; entries?: Entry[] };
  const entries = blogMap.entries ?? [];
  const badges = entries.flatMap((e) => e.badges ?? []);
  const versionDist: Record<string, number> = {};
  for (const b of badges) versionDist[b.version] = (versionDist[b.version] ?? 0) + 1;
  const sections: Record<string, { entries: number; mapped: number; badges: number }> = {};
  for (const e of entries) {
    const s = sections[e.section] ?? { entries: 0, mapped: 0, badges: 0 };
    s.entries++;
    if (e.status !== 'unmapped') s.mapped++;
    s.badges += (e.badges ?? []).length;
    sections[e.section] = s;
  }
  const manifest = {
    mirrorVersion: 2,
    source: blogMap.blogUrl ?? null,
    entryCount: entries.length,
    badgeStats: {
      total: badges.length,
      shipped: badges.filter((b) => b.verb === 'Shipped in').length,
      improved: badges.filter((b) => b.verb === 'Improved in').length,
      accent: badges.filter((b) => b.tone === 'accent').length,
      muted: badges.filter((b) => b.tone === 'muted').length,
      byVersion: Object.fromEntries(Object.entries(versionDist).sort((a, b) => b[0].localeCompare(a[0]))),
    },
    sections,
    files: copied.sort(),
    // artifact-manifest: per-file SHA-256 (the artifact interface, §194) so any
    // consumer can validate a served file against the manifest without recompute.
    hashes: Object.fromEntries(copied.sort().map((f) => [f, sha256Hex(Buffer.from(files[f]!, 'utf8'))])),
    generatedBy: 'bun run blog:assets (tools/blog-assets-mirror.ts)',
  };
  files['index.json'] = JSON.stringify(manifest, null, 2) + '\n';
  return { files, manifest };
}

function main(): number {
  const check = process.argv.includes('--check');
  mkdirSync(OUT, { recursive: true });
  const { files } = generate();
  const keys = Object.keys(files).sort();
  let missing = false;
  let drifted = false;
  for (const k of keys) {
    const pth = join(OUT, k);
    if (!existsSync(pth)) { missing = true; continue; }
    if (readFileSync(pth, 'utf8') !== files[k]) drifted = true;
  }
  if (check) {
    if (missing) {
      for (const k of keys) writeFileSync(join(OUT, k), files[k]!);
      console.log('blog:assets - mirror missing files, bootstrapped (' + keys.length + ' files)');
      return 0;
    }
    if (drifted) {
      console.log('blog:assets FAIL - public/blog/ is stale; run `bun run blog:assets`');
      return 1;
    }
    console.log('blog:assets - mirror current (' + keys.length + ' files)');
    return 0;
  }
  for (const k of keys) writeFileSync(join(OUT, k), files[k]!);
  console.log('blog:assets - wrote public/blog/ (' + keys.length + ' files)');
  return 0;
}

if (import.meta.main) process.exit(main());