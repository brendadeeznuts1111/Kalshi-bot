/**
 * `bun run bun:docs-index` — index + cache Bun reference docs locally.
 *
 * The page list is DISCOVERED dynamically from the source, not curated:
 *   tag/repo  GitHub trees API (git/trees/<ref>?recursive=1) filtered to
 *             docs/<scope>/**.mdx (64 runtime pages as of bun 1.4.0).
 *   site      bun.com sitemap.xml filtered to /docs/<scope>/.
 * The former 16-page curated list survives only as an offline fallback
 * when discovery fails (no network / API error).
 *
 * Sources:
 *   tag  (default) oven-sh/bun git tag matching the INSTALLED runtime
 *        (bun-v<Bun.version>) — exactly the docs for the binary in use.
 *   repo             oven-sh/bun main branch — may be AHEAD of runtime.
 *   site             bun.com/docs — released-docs surface, a rendering
 *        of the repo .mdx (frontmatter stripped + render hints).
 *        bun.sh is a BYTE-IDENTICAL alias (same deployment, different
 *        Cloudflare edge IPs; verified on workers/sql/fetch/server/
 *        webview/api + sitemap) — no separate source needed.
 *
 * Scope:
 *   runtime (default)  docs/runtime/** (API reference surface).
 *   all                every page under docs/.
 *
 * Offline behavior: --check is fully offline (reads local JSON only, zero
 * network). Discovery + page fetch need network; on discovery failure the
 * tool falls back to the curated list. Before any fan-out the tool warms
 * DNS via Bun.dns.prefetch for api.github.com / raw.githubusercontent.com /
 * bun.com (best effort, in-process, never fails).
 *
 * Flags:
 *   --refresh       re-fetch pages even when cached recently (also forces
 *                    live discovery).
 *   --check         report cache age/source without fetching; exits 1
 *                    unless every discovered page is cached, fresh (<24h),
 *                    ok, and from the requested source (gate-able).
 *   --source X      one of tag|repo|site (default tag).
 *   --scope X       one of runtime|all (default runtime).
 *
 * Provenance: INDEX.json entries carry `source`; a page cached from one
 * source is re-fetched when another source is requested (source-aware
 * freshness). DISCOVERY.json records the discovered page list per
 * source/scope/ref so --check works offline.
 *
 * @see docs/AGENT-PITFALLS.md (verify against the reference, not guesses)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { hasFlag, argValue } from '../src/cli/argv.ts';
import { fetchPool, warmDns } from '../src/lib/fetch-pool.ts';
import { statusLine } from '../src/research/terminal-out.ts';
import type { DnsWarmTarget } from '../src/lib/fetch-pool.ts';

assertBunAtLeast('1.4.0', 'bun:docs-index');

const ROOT = join(import.meta.dir, '..');
const CACHE_DIR = join(ROOT, 'research/cache/bun-docs');
const INDEX_PATH = join(CACHE_DIR, 'INDEX.json');
const DISCOVERY_PATH = join(CACHE_DIR, 'DISCOVERY.json');
const TAG_REF = 'bun-v' + Bun.version;
const REPO_REF = 'main';
const TREES_API = 'https://api.github.com/repos/oven-sh/bun/git/trees/';
const TAG_BASE = 'https://raw.githubusercontent.com/oven-sh/bun/' + TAG_REF + '/docs/';
const REPO_BASE = 'https://raw.githubusercontent.com/oven-sh/bun/main/docs/';
const SITE_BASE = 'https://bun.com/docs/';
const SITEMAP_URL = 'https://bun.com/sitemap.xml';
const FRESH_MS = 24 * 60 * 60 * 1000;

type Source = 'tag' | 'repo' | 'site';
type Scope = 'runtime' | 'all';

/** Offline fallback when discovery fails (formerly the curated list). */
const FALLBACK_PAGES: Array<{ name: string; path: string }> = [
  { name: 'workers', path: 'runtime/workers.mdx' },
  { name: 'child-process', path: 'runtime/child-process.mdx' },
  { name: 'image', path: 'runtime/image.mdx' },
  { name: 'markdown', path: 'runtime/markdown.mdx' },
  { name: 'xml', path: 'runtime/xml.mdx' },
  { name: 'secrets', path: 'runtime/secrets.mdx' },
  { name: 'csrf', path: 'runtime/csrf.mdx' },
  { name: 'cookies', path: 'runtime/cookies.mdx' },
  { name: 'networking-dns', path: 'runtime/networking/dns.mdx' },
  { name: 'networking-fetch', path: 'runtime/networking/fetch.mdx' },
  { name: 'networking-tcp', path: 'runtime/networking/tcp.mdx' },
  { name: 'networking-udp', path: 'runtime/networking/udp.mdx' },
  { name: 'http-websockets', path: 'runtime/http/websockets.mdx' },
  { name: 'http-server', path: 'runtime/http/server.mdx' },
  { name: 'glob', path: 'runtime/glob.mdx' },
  { name: 'sql', path: 'runtime/sql.mdx' },
];

type IndexEntry = { name: string; source: Source; sourceUrl: string; fetchedAt: string; bytes: number; ok: boolean };
type Index = { pages: IndexEntry[]; fetchedAt: string };
type Discovery = { at: string; source: Source; scope: Scope; ref: string; pages: Array<{ name: string; path: string }> };

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; }
  catch { return null; }
}

function resolveSource(raw: string | undefined): Source {
  return raw === 'repo' || raw === 'site' ? raw : 'tag';
}

function resolveScope(raw: string | undefined): Scope {
  return raw === 'all' ? 'all' : 'runtime';
}

function sourceBase(s: Source): string {
  return s === 'tag' ? TAG_BASE : s === 'repo' ? REPO_BASE : SITE_BASE;
}

/** Hosts this tool talks to (warmed before discovery + fan-out). */
const WARM_HOSTS: DnsWarmTarget[] = [
  { hostname: 'api.github.com', port: 443 },
  { hostname: 'raw.githubusercontent.com', port: 443 },
  { hostname: 'bun.com', port: 443 },
];

/** Cache file name from a docs-relative path (runtime/networking/fetch.mdx -> networking-fetch). */
function nameFromPath(repoPath: string): string {
  const parts = repoPath.replace(/\.mdx$/, '').split('/');
  // Drop a leading 'runtime' scope root (runtime/workers.mdx -> workers);
  // under --scope all, keep api/... guides/... and root-level pages whole.
  if (parts.length > 1 && parts[0] === 'runtime') parts.shift();
  return parts.join('-') || 'index';
}

async function discoverPages(source: Source, scope: Scope): Promise<Array<{ name: string; path: string }>> {
  let paths: string[] = [];
  if (source === 'site') {
    const xml = await (await fetch(SITEMAP_URL)).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    const sitePrefix = 'https://bun.com/docs/' + (scope === 'all' ? '' : 'runtime/');
    paths = locs
      .filter((l) => l.startsWith(sitePrefix) && l !== sitePrefix.slice(0, -1))
      .map((l) => l.slice('https://bun.com/docs/'.length) + '.mdx');
  } else {
    const prefix = scope === 'all' ? 'docs/' : 'docs/runtime/';
    const ref = source === 'tag' ? TAG_REF : REPO_REF;
    const res = await fetch(TREES_API + ref + '?recursive=1');
    const json = (await res.json()) as { tree?: Array<{ type: string; path: string }> };
    paths = (json.tree ?? [])
      .filter((t) => t.type === 'blob' && t.path.startsWith(prefix) && t.path.endsWith('.mdx'))
      .map((t) => t.path.slice('docs/'.length));
  }
  paths.sort();
  const seen = new Set<string>();
  const pages: Array<{ name: string; path: string }> = [];
  for (const p of paths) {
    let name = nameFromPath(p);
    if (seen.has(name)) {
      let n = 1;
      while (seen.has(name + '-' + n)) n++;
      name = name + '-' + n;
    }
    seen.add(name);
    pages.push({ name, path: p });
  }
  if (pages.length === 0) throw new Error('discovery returned 0 pages');
  return pages;
}

async function main(): Promise<void> {
  const refresh = hasFlag('refresh');
  const check = hasFlag('check');
  const source = resolveSource(argValue('source'));
  const scope = resolveScope(argValue('scope'));
  const ref = source === 'tag' ? TAG_REF : source === 'repo' ? REPO_REF : 'sitemap';
  const cachedDiscovery = readJson<Discovery>(DISCOVERY_PATH);
  const discoveryFresh = cachedDiscovery !== null && cachedDiscovery.source === source && cachedDiscovery.scope === scope && Date.now() - Date.parse(cachedDiscovery.at) < FRESH_MS;
  if (check) {
    if (!discoveryFresh) {
      console.log('discovery: none or stale (' + source + '/' + scope + ') - run without --check first');
      process.exit(1);
    }
    const pages = cachedDiscovery!.pages;
    const index = readJson<Index>(INDEX_PATH) ?? { pages: [], fetchedAt: new Date(0).toISOString() };
    const byName = new Map(index.pages.map((p) => [p.name, p]));
    let problems = 0;
    for (const p of pages) {
      const c = byName.get(p.name);
      if (!c) { console.log('  ' + p.name + ': not cached'); problems++; continue; }
      if (!c.ok) { console.log('  ' + p.name + ': FETCH FAILED'); problems++; continue; }
      const src = (c as { source?: string }).source ?? 'legacy';
      const ageH = (Date.now() - Date.parse(c.fetchedAt)) / 3.6e6;
      const stale = ageH > 24;
      const srcOk = src === source;
      let line = '  ' + p.name + ': ' + src + ' ' + c.bytes + 'b @ ' + c.fetchedAt.slice(0, 10);
      if (stale) line += '  [stale ' + ageH.toFixed(0) + 'h > 24h]';
      if (!srcOk) { line += '  [source mismatch: requested ' + source + ']'; problems++; }
      console.log(line);
    }
    const verdict = problems === 0 ? 'ok' : problems + ' problem(s)';
    console.log('check (' + source + '/' + scope + '): ' + verdict + ' - ' + pages.length + ' pages');
    process.exit(problems === 0 ? 0 : 1);
    return;
  }
  let pages: Array<{ name: string; path: string }>;
  try {
    pages = discoveryFresh && !refresh ? cachedDiscovery!.pages : await discoverPages(source, scope);
  } catch (err) {
    console.warn('discovery failed (' + (err as Error).message + ') - using fallback ' + FALLBACK_PAGES.length + ' pages');
    pages = FALLBACK_PAGES;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(DISCOVERY_PATH, JSON.stringify({ at: new Date().toISOString(), source, scope, ref, pages }, null, 2) + '\n');
  warmDns(WARM_HOSTS); // shared warmed lookups before discovery + fan-out
  const index = readJson<Index>(INDEX_PATH) ?? { pages: [], fetchedAt: new Date(0).toISOString() };
  const byName = new Map(index.pages.map((p) => [p.name, p]));
  const entries: IndexEntry[] = [];
  const needFetch: Array<{ page: (typeof pages)[number]; url: string }> = [];
  for (const page of pages) {
    const existing = byName.get(page.name);
    const fresh = existing?.ok && existing.source === source && Date.now() - Date.parse(existing.fetchedAt) < FRESH_MS;
    if (!refresh && fresh) {
      entries.push(existing);
    } else {
      needFetch.push({ page, url: sourceBase(source) + (source === 'site' ? page.path.replace(/\.mdx$/, '.md') : page.path) });
    }
  }
  // Bounded fan-out via the shared fetch-pool default: DNS already warmed,
  // max 16 concurrent (HTTP/1.1 = one TCP connection each), bodies always
  // consumed (pooling-friendly), 30s per-request timeout. Order preserved.
  const urls = needFetch.map((n) => n.url);
  const fetched = await fetchPool(urls, { concurrency: 16, timeoutMs: 30_000 });
  for (let i = 0; i < needFetch.length; i++) {
    const page = needFetch[i]!.page;
    const r = fetched[i]!;
    if (r.ok) writeFileSync(join(CACHE_DIR, page.name + '.mdx'), r.text);
    entries.push({ name: page.name, source, sourceUrl: r.url, fetchedAt: new Date().toISOString(), bytes: r.bytes, ok: r.ok });
    // Color marks via Bun.color('ansi') (TTY-aware, like pre-commit's
    // local paint); statusLine's padAnsi ignores ANSI so columns align.
    const open = Bun.color(r.ok ? 'green' : 'red', 'ansi') ?? '';
    const mark = (open ? open + (r.ok ? 'cached' : 'FAILED') + '\u001b[0m' : r.ok ? 'cached' : 'FAILED');
    const detail = '(' + source + ', ' + r.bytes + 'b' + (r.error ? ' - ' + r.error : '') + ')';
    console.log(statusLine(mark, page.name, detail));
  }
  writeFileSync(INDEX_PATH, JSON.stringify({ pages: entries, fetchedAt: new Date().toISOString() }, null, 2) + '\n');
  const okCount = entries.filter((e) => e.ok).length;
  console.log('index: ' + okCount + '/' + entries.length + ' pages (' + source + '/' + scope + ') · ' + CACHE_DIR);
  process.exit(okCount === entries.length ? 0 : 1);
}

await main();