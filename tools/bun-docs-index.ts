/**
 * `bun run bun:docs-index` — index + cache Bun reference docs locally.
 *
 * Fetches curated Bun reference pages (raw markdown from the oven-sh/bun
 * repo docs/ tree) into research/cache/bun-docs/<name>.mdx with an
 * INDEX.json manifest (source, source URL, fetchedAt, bytes). Future
 * verification can cite the LOCAL copy and detect docs drift instead of
 * re-fetching.
 *
 * Sources:
 *   tag  (default) oven-sh/bun git tag matching the INSTALLED runtime
 *        (bun-v<Bun.version>) — exactly the docs for the binary in use.
 *   repo             oven-sh/bun main branch raw .mdx — may be AHEAD of
 *        the installed runtime (e.g. fetch.preconnect https / Bun.html).
 *   site             bun.com/docs raw .md — released-docs surface; a
 *        rendering of the repo .mdx (frontmatter stripped + render
 *        hints). Content equivalent.
 *
 * Flags:
 *   --refresh       re-fetch pages even when cached recently.
 *   --check         report cache age/source without fetching.
 *   --source X      one of tag|repo|site (default tag).
 *
 * Provenance: INDEX.json entries carry `source`; a page cached from one
 * source is re-fetched when another source is requested (source-aware
 * freshness), and --check flags stale-source pages.
 *
 * @see docs/AGENT-PITFALLS.md (verify against the reference, not guesses)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { hasFlag, argValue } from '../src/cli/argv.ts';

assertBunAtLeast('1.4.0', 'bun:docs-index');

const ROOT = join(import.meta.dir, '..');
const CACHE_DIR = join(ROOT, 'research/cache/bun-docs');
const INDEX_PATH = join(CACHE_DIR, 'INDEX.json');
const TAG_BASE = 'https://raw.githubusercontent.com/oven-sh/bun/bun-v' + Bun.version + '/docs/';
const REPO_BASE = 'https://raw.githubusercontent.com/oven-sh/bun/main/docs/';
const SITE_BASE = 'https://bun.com/docs/';

type Source = 'tag' | 'repo' | 'site';

/** Curated reference pages (repo-relative docs paths, .mdx). */
const PAGES: Array<{ name: string; path: string }> = [
  { name: 'workers', path: 'runtime/workers.mdx' },
  { name: 'child-process', path: 'runtime/child-process.mdx' },
  { name: 'image', path: 'runtime/image.mdx' },
  { name: 'markdown', path: 'runtime/markdown.mdx' },
  { name: 'xml', path: 'runtime/xml.mdx' },
  { name: 'secrets', path: 'runtime/secrets.mdx' },
  { name: 'csrf', path: 'runtime/csrf.mdx' },
  { name: 'cookies', path: 'runtime/cookies.mdx' },
  { name: 'dns', path: 'runtime/networking/dns.mdx' },
  { name: 'fetch', path: 'runtime/networking/fetch.mdx' },
  { name: 'tcp', path: 'runtime/networking/tcp.mdx' },
  { name: 'udp', path: 'runtime/networking/udp.mdx' },
  { name: 'websockets', path: 'runtime/http/websockets.mdx' },
  { name: 'server', path: 'runtime/http/server.mdx' },
  { name: 'glob', path: 'runtime/glob.mdx' },
  { name: 'sql', path: 'runtime/sql.mdx' },
];

type IndexEntry = { name: string; source: Source; sourceUrl: string; fetchedAt: string; bytes: number; ok: boolean };
type Index = { pages: IndexEntry[]; fetchedAt: string };

function readIndex(): Index | null {
  if (!existsSync(INDEX_PATH)) return null;
  try { return JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as Index; }
  catch { return null; }
}

function resolveSource(raw: string | undefined): Source {
  return raw === 'repo' || raw === 'site' ? raw : 'tag';
}

function sourceBase(s: Source): string {
  return s === 'tag' ? TAG_BASE : s === 'repo' ? REPO_BASE : SITE_BASE;
}

function sourceUrlFor(s: Source, path: string): string {
  return sourceBase(s) + (s === 'site' ? path.replace(/\.mdx$/, '.md') : path);
}

async function main(): Promise<void> {
  const refresh = hasFlag('refresh');
  const check = hasFlag('check');
  const source = resolveSource(argValue('source'));
  const index = readIndex() ?? { pages: [], fetchedAt: new Date(0).toISOString() };
  const byName = new Map(index.pages.map((p) => [p.name, p]));
  if (check) {
    for (const p of PAGES) {
      const c = byName.get(p.name);
      if (!c) { console.log('  ' + p.name + ': not cached'); continue; }
      const line = '  ' + p.name + ': ' + (c.ok ? c.source + ' ' + c.bytes + 'b @ ' + c.fetchedAt.slice(0, 10) : 'FETCH FAILED');
      console.log(c.source === source ? line : line + '  [source mismatch: requested ' + source + ']');
    }
    process.exit(0);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const entries: IndexEntry[] = [];
  for (const page of PAGES) {
    const existing = byName.get(page.name);
    const fresh = existing?.ok && existing.source === source && Date.now() - Date.parse(existing.fetchedAt) < 24 * 60 * 60 * 1000;
    if (!refresh && fresh) {
      entries.push(existing);
      continue;
    }
    const url = sourceUrlFor(source, page.path);
    const res = await fetch(url);
    const ok = res.ok;
    const text = ok ? await res.text() : '';
    if (ok) writeFileSync(join(CACHE_DIR, page.name + '.mdx'), text);
    entries.push({ name: page.name, source, sourceUrl: url, fetchedAt: new Date().toISOString(), bytes: text.length, ok });
    console.log('  ' + (ok ? 'cached ' : 'FAILED ') + page.name + ' (' + source + ', ' + text.length + 'b)');
  }
  writeFileSync(INDEX_PATH, JSON.stringify({ pages: entries, fetchedAt: new Date().toISOString() }, null, 2) + '\n');
  const okCount = entries.filter((e) => e.ok).length;
  console.log('index: ' + okCount + '/' + entries.length + ' pages (' + source + ') · ' + CACHE_DIR);
  process.exit(okCount === entries.length ? 0 : 1);
}

await main();