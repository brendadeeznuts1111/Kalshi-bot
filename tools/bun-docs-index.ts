/**
 * `bun run bun:docs-index` — index + cache Bun reference docs locally.
 *
 * Fetches curated Bun reference pages (raw markdown from the oven-sh/bun
 * repo docs/ tree) into research/cache/bun-docs/<name>.mdx with an
 * INDEX.json manifest (source URL, fetchedAt, bytes). Future verification
 * can cite the LOCAL copy and detect docs drift instead of re-fetching.
 *
 * Flags:
 *   --refresh   re-fetch pages even when cached recently.
 *   --check     report cache age/drift without fetching.
 *
 * @see docs/AGENT-PITFALLS.md (verify against the reference, not guesses)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { hasFlag } from '../src/cli/argv.ts';

assertBunAtLeast('1.4.0', 'bun:docs-index');

const ROOT = join(import.meta.dir, '..');
const CACHE_DIR = join(ROOT, 'research/cache/bun-docs');
const INDEX_PATH = join(CACHE_DIR, 'INDEX.json');
const RAW = 'https://raw.githubusercontent.com/oven-sh/bun/main/docs/';

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

type IndexEntry = { name: string; sourceUrl: string; fetchedAt: string; bytes: number; ok: boolean };
type Index = { pages: IndexEntry[]; fetchedAt: string };

function readIndex(): Index | null {
  if (!existsSync(INDEX_PATH)) return null;
  try { return JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as Index; }
  catch { return null; }
}

async function main(): Promise<void> {
  const refresh = hasFlag('refresh');
  const check = hasFlag('check');
  const index = readIndex() ?? { pages: [], fetchedAt: new Date(0).toISOString() };
  const byName = new Map(index.pages.map((p) => [p.name, p]));
  if (check) {
    for (const p of PAGES) {
      const c = byName.get(p.name);
      console.log('  ' + p.name + ': ' + (c ? c.ok ? c.bytes + 'b @ ' + c.fetchedAt.slice(0, 10) : 'FETCH FAILED' : 'not cached'));
    }
    process.exit(0);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const entries: IndexEntry[] = [];
  for (const page of PAGES) {
    const existing = byName.get(page.name);
    if (!refresh && existing?.ok && Date.now() - Date.parse(existing.fetchedAt) < 24 * 60 * 60 * 1000) {
      entries.push(existing);
      continue;
    }
    const url = RAW + page.path;
    const res = await fetch(url);
    const ok = res.ok;
    const text = ok ? await res.text() : '';
    if (ok) writeFileSync(join(CACHE_DIR, page.name + '.mdx'), text);
    entries.push({ name: page.name, sourceUrl: url, fetchedAt: new Date().toISOString(), bytes: text.length, ok });
    console.log('  ' + (ok ? 'cached ' : 'FAILED ') + page.name + ' (' + text.length + 'b)');
  }
  writeFileSync(INDEX_PATH, JSON.stringify({ pages: entries, fetchedAt: new Date().toISOString() }, null, 2) + '\n');
  const okCount = entries.filter((e) => e.ok).length;
  console.log('index: ' + okCount + '/' + entries.length + ' pages · ' + CACHE_DIR);
  process.exit(okCount === entries.length ? 0 : 1);
}

await main();
