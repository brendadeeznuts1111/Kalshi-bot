#!/usr/bin/env bun
/**
 * `bun run bun:docs-index` — index + cache the Bun docs locally, working off
 * the TRUE index: https://bun.com/llm.txt — Bun's official LLM-oriented docs
 * map (sibling of bun.com/docs/llms.txt, which the grounding pipeline already
 * validates URLs against, src/lib/ground.ts).
 *
 * Single source, no discovery bloat: llm.txt IS the page list. The indexer
 * fetches llm.txt, parses its .md links, and caches each page as raw markdown
 * from bun.com. GitHub trees API (tag/repo), sitemap.xml parsing, scopes, and
 * the curated fallback are RETIRED (2026-08 debloat; docs/AGENT-PITFALLS §9).
 *
 * Flags:
 *   --refresh  re-fetch pages even when cached recently (also re-reads llm.txt).
 *   --check    report cache age/source without fetching; exits 1 unless the
 *              cached discovery is fresh (<24h) and every page is cached,
 *              fresh, ok, and source "llm" (gate-able).
 *
 * Artifacts (research/cache/bun-docs/, gitignored):
 *   DISCOVERY.json  { at, source: "llm", llmUrl, llmHash, pages: [{name,url}] }
 *   INDEX.json      { pages: [{name, source, sourceUrl, fetchedAt, bytes, ok}] }
 *   <name>.md       the cached page bodies.
 * DISCOVERY.json llmHash feeds the maps.toml triple-lock (docs.ref =
 * "llm#" + llmHash), so an llm.txt change drifts the lock exactly like a Bun
 * bump used to via the git tag ref.
 *
 * @see docs/AGENT-PITFALLS.md (verify against the reference, not guesses)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { hasFlag } from '../src/cli/argv.ts';
import { fetchPool, warmDns } from '../src/lib/fetch-pool.ts';
import type { DnsWarmTarget } from '../src/lib/fetch-pool.ts';
import { statusLine, brandMark } from '../src/research/terminal-out.ts';

assertBunAtLeast('1.4.0', 'bun:docs-index');

const ROOT = join(import.meta.dir, '..');
const CACHE_DIR = join(ROOT, 'research/cache/bun-docs');
const INDEX_PATH = join(CACHE_DIR, 'INDEX.json');
const DISCOVERY_PATH = join(CACHE_DIR, 'DISCOVERY.json');
/** The true index — the page list comes from here and nowhere else. */
export const LLM_TXT_URL = 'https://bun.com/llm.txt';
const DOCS_PREFIX = 'https://bun.com/docs/';
const FRESH_MS = 24 * 60 * 60 * 1000;

type IndexEntry = { name: string; source: 'llm'; sourceUrl: string; fetchedAt: string; bytes: number; ok: boolean };
type Index = { pages: IndexEntry[]; fetchedAt: string };
/**
 * One llm.txt entry. `index` marks section-landing pages (the index.md
 * links at a section root): llm.txt lists them, but bun.com does not serve
 * raw .md for them (404/308) — they are navigation landings, not content, so
 * they are recorded in DISCOVERY.json (the true map is fully represented)
 * but never cached.
 */
type Page = { name: string; url: string; index?: boolean };
type Discovery = { at: string; source: 'llm'; llmUrl: string; llmHash: string; pages: Page[] };

/** Hosts this tool talks to (warmed before discovery + fan-out). */
const WARM_HOSTS: DnsWarmTarget[] = [{ hostname: 'bun.com', port: 443 }];

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; }
  catch { return null; }
}

/**
 * Page name from a bun.com/docs URL: strip the prefix + .md, drop a leading
 * "runtime" segment, join the rest with "-" (runtime/child-process.md ->
 * child-process; guides/process/argv.md -> guides-process-argv; bundler/
 * plugins.md -> bundler-plugins; root typescript.md -> typescript).
 */
export function nameFromDocsUrl(url: string): string {
  const rel = url.startsWith(DOCS_PREFIX) ? url.slice(DOCS_PREFIX.length) : url;
  const parts = rel.replace(/.md$/, '').split('/');
  if (parts.length > 1 && parts[0] === 'runtime') parts.shift();
  return parts.join('-') || 'index';
}

/**
 * Fetch the true index and derive the page list. llm.txt is authoritative:
 * links are markdown `[title](https://bun.com/docs/...md)` entries; the
 * returned llmHash (Bun.hash of the map text) fingerprints the map for the
 * maps.toml triple-lock.
 */
export async function fetchLlmIndex(): Promise<{ pages: Page[]; llmHash: string; text: string }> {
  const res = await fetch(LLM_TXT_URL);
  if (!res.ok) throw new Error('llm.txt fetch failed: HTTP ' + res.status);
  const text = await res.text();
  const urls = [...text.matchAll(/\]\((https:\/\/bun\.com\/docs\/[^)#]+\.md)\)/g)].map((m) => m[1]!);
  const seen = new Set<string>();
  const pages: Page[] = [];
  for (const url of urls.sort()) {
    if (seen.has(url)) continue;
    seen.add(url);
    const index = url.endsWith('/index.md');
    let name = nameFromDocsUrl(url);
    if (pages.some((p) => p.name === name)) {
      let n = 1;
      while (pages.some((p) => p.name === name + '-' + n)) n++;
      name = name + '-' + n;
    }
    pages.push({ name, url, index });
  }
  if (pages.length === 0) throw new Error('llm.txt yielded 0 pages');
  // 16 zero-padded hex: Bun.hash(...).toString(16) can drop leading zeros.
  return { pages, llmHash: Bun.hash(text).toString(16).padStart(16, '0'), text };
}

function readDiscovery(): Discovery | null {
  return readJson<Discovery>(DISCOVERY_PATH);
}

function discoveryFresh(disc: Discovery | null): boolean {
  return disc !== null
    && disc.source === 'llm'
    && /^[0-9a-f]{16}$/.test(disc.llmHash)
    && disc.pages.length > 0
    && Date.now() - Date.parse(disc.at) < FRESH_MS;
}

async function main(): Promise<void> {
  const refresh = hasFlag('refresh');
  const check = hasFlag('check');
  const cachedDiscovery = readDiscovery();

  if (check) {
    if (!discoveryFresh(cachedDiscovery)) {
      console.log('discovery: none or stale (llm.txt) - run without --check first');
      process.exit(1);
    }
    const pages = cachedDiscovery!.pages;
    const index = readJson<Index>(INDEX_PATH) ?? { pages: [], fetchedAt: new Date(0).toISOString() };
    const byName = new Map(index.pages.map((p) => [p.name, p]));
    let problems = 0;
    for (const p of pages) {
      if (p.index) { console.log('  ' + p.name + ': index landing (not cached)'); continue; }
      const c = byName.get(p.name);
      if (!c) { console.log('  ' + p.name + ': not cached'); problems++; continue; }
      if (!c.ok) { console.log('  ' + p.name + ': FETCH FAILED'); problems++; continue; }
      const src = (c as { source?: string }).source ?? 'legacy';
      const ageH = (Date.now() - Date.parse(c.fetchedAt)) / 3.6e6;
      const stale = ageH > 24;
      const srcOk = src === 'llm';
      let line = '  ' + p.name + ': ' + src + ' ' + c.bytes + 'b @ ' + c.fetchedAt.slice(0, 10);
      if (stale) line += '  [stale ' + ageH.toFixed(0) + 'h > 24h]';
      if (!srcOk) { line += '  [source mismatch: requested llm]'; problems++; }
      console.log(line);
    }
    const verdict = problems === 0 ? 'ok' : problems + ' problem(s)';
    console.log('check (llm): ' + verdict + ' - ' + pages.length + ' pages');
    process.exit(problems === 0 ? 0 : 1);
    return;
  }

  let pages: Page[];
  let llmHash: string;
  if (!refresh && discoveryFresh(cachedDiscovery)) {
    pages = cachedDiscovery!.pages;
    llmHash = cachedDiscovery!.llmHash;
  } else {
    const fetched = await fetchLlmIndex();
    pages = fetched.pages;
    llmHash = fetched.llmHash;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(DISCOVERY_PATH, JSON.stringify({ at: new Date().toISOString(), source: 'llm', llmUrl: LLM_TXT_URL, llmHash, pages }, null, 2) + '\n');
  warmDns(WARM_HOSTS); // shared warmed lookups before fan-out

  const index = readJson<Index>(INDEX_PATH) ?? { pages: [], fetchedAt: new Date(0).toISOString() };
  const byName = new Map(index.pages.map((p) => [p.name, p]));
  const entries: IndexEntry[] = [];
  const needFetch: Array<{ page: Page }> = [];
  for (const page of pages) {
    if (page.index) continue; // landing pages are recorded, never cached
    const existing = byName.get(page.name);
    const fresh = existing?.ok && existing.source === 'llm' && Date.now() - Date.parse(existing.fetchedAt) < FRESH_MS;
    if (!refresh && fresh) {
      entries.push(existing);
    } else {
      needFetch.push({ page });
    }
  }
  // Bounded fan-out via the shared fetch-pool default: DNS already warmed,
  // max 16 concurrent (HTTP/1.1 = one TCP connection each), bodies always
  // consumed (pooling-friendly), 30s per-request timeout. Order preserved.
  const fetched = await fetchPool(needFetch.map((n) => n.page.url), { concurrency: 16, timeoutMs: 30_000 });
  for (let i = 0; i < needFetch.length; i++) {
    const page = needFetch[i]!.page;
    const r = fetched[i]!;
    if (r.ok) writeFileSync(join(CACHE_DIR, page.name + '.md'), r.text);
    entries.push({ name: page.name, source: 'llm', sourceUrl: r.url, fetchedAt: new Date().toISOString(), bytes: r.bytes, ok: r.ok });
    const mark = brandMark(r.ok ? 'cached' : 'FAILED', r.ok ? 'ok' : 'bad');
    const detail = '(llm, ' + r.bytes + 'b' + (r.error ? ' - ' + r.error : '') + ')';
    console.log(statusLine(mark, page.name, detail));
  }

  // llm.txt is authoritative: the cached set is EXACTLY the map's pages.
  // Remove stale cache files (previous-source .mdx, pages dropped from the map).
  const newNames = new Set(pages.map((p) => p.name));
  for (const f of readdirSync(CACHE_DIR)) {
    const isMdx = f.endsWith('.mdx');
    const base = f.endsWith('.md') ? f.slice(0, -3) : f.endsWith('.mdx') ? f.slice(0, -4) : null;
    if (base !== null && (isMdx || !newNames.has(base))) rmSync(join(CACHE_DIR, f), { force: true });
  }

  // Preserve non-managed top-level keys (mapsHash/mapsMeta and any future
  // pipeline metadata) written by other steps (docs:refresh triple-lock).
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(index)) {
    if (k !== 'pages' && k !== 'fetchedAt') extra[k] = v;
  }
  writeFileSync(INDEX_PATH, JSON.stringify({ ...extra, pages: entries, fetchedAt: new Date().toISOString() }, null, 2) + '\n');
  const okCount = entries.filter((e) => e.ok).length;
  console.log('index: ' + okCount + '/' + entries.length + ' pages (llm) · ' + CACHE_DIR);
  process.exit(okCount === entries.length ? 0 : 1);
}

// Import-safe: only the CLI entry runs the pipeline (repo convention —
// import.meta.main, see docs/BUN_NATIVE.md). Tests import this module for
// nameFromDocsUrl / fetchLlmIndex without triggering network/cache writes.
if (import.meta.main) {
  await main();
}
