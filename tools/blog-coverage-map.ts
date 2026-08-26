#!/usr/bin/env bun
/**
 * blog:coverage — extract every code block from the Bun 1.4 blog post, attribute
 * it to its section/heading, and map it to an EXISTING demo route/function in
 * this repo (src/research/*-page.ts demo pages behind /bun/* routes, tools/*-probe.ts
 * probe tools, serve.ts routes, playground). Reports covered vs uncovered so the
 * coverage registry (.data/blog-map.json mappedTo) can be updated for every
 * behavior that has a demo.
 *
 * Data: research/cache/bun-blog.html (the blog) · research/outputs/blog-codeblocks-check.json
 * (per-block typecheck verdict) · .data/blog-map.json (heading → mappedTo registry).
 *
 * Output: research/outputs/blog-coverage-map.json + blog-coverage-map.md
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const HTML_PATH = join(ROOT, 'research/cache/bun-blog.html');
const LEDGER_PATH = join(ROOT, 'research/outputs/blog-codeblocks-check.json');
const REGISTRY_PATH = join(ROOT, '.data/blog-map.json');
const OUT_DIR = join(ROOT, 'research/outputs');

const html = readFileSync(HTML_PATH, 'utf8');

// ------------------------------------------------------------- pre-block load
const preRe = /<pre[^>]*class="shiki">([\s\S]*?)<\/pre>/g;
const pres: string[] = [];
let m: RegExpExecArray | null;
while ((m = preRe.exec(html)) !== null) pres.push(m[1]!);

function preText(inner: string): string {
  return inner
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// ------------------------------------------------------------- heading walk
function* headings(src: string): Generator<{ level: number; id: string; title: string; pos: number }> {
  const re = /<h([234])\s([^>]*)>([\s\S]*?)<\/(?:h[234])>/g;
  let hm: RegExpExecArray | null;
  while ((hm = re.exec(src)) !== null) {
    const level = Number(hm[1]!);
    const attrs = hm[2]!;
    const idm = attrs.match(/id="([^"]+)"/);
    const inner = hm[3]!;
    const title = inner
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;|&#x27;/g, "'")
      .trim();
    if (idm) yield { level, id: idm[1]!, title, pos: hm.index };
  }
}

// pre block positions
const prePos: number[] = [];
const preRe2 = /<pre[^>]*class="shiki">/g;
for (const pm of html.matchAll(preRe2)) prePos.push(pm.index!);

// map each pre index -> nearest heading id (by document position)
const heads = [...headings(html)];
function headingFor(preIdx: number): { id: string; title: string; level: number } {
  const pos = prePos[preIdx]!;
  let best = { id: 'intro', title: '(intro / before first heading)', level: 0 };
  for (const h of heads) if (h.pos < pos) best = { id: h.id, title: h.title, level: h.level };
  return best;
}

// ------------------------------------------------------------- registry + ledger
type Registry = { entries: Array<Record<string, any>> };
const registry: Registry = existsSync(REGISTRY_PATH) ? JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) : { entries: [] };
const registryById = new Map<string, Record<string, any>>();
for (const e of registry.entries) registryById.set(e.id, e);

const ledgerRows = new Map<number, any>();
if (existsSync(LEDGER_PATH)) {
  const l = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
  for (const row of l.rows ?? []) ledgerRows.set(row.n, row);
}

// ------------------------------------------------------------- demo catalog
type Demo = { key: string; route: string; file: string; fn: string; keywords: RegExp };
export const DEMOS: Demo[] = [
  { key: 'networking', route: '/bun/networking', file: 'src/research/networking-page.ts', fn: 'renderNetworkingPage', keywords: /Bun\.serve|Bun\.listen|Bun\.connect|Bun\.udpSocket|routes|dir\s*:|req\.file|http3|sendfile|Range|206|304|ETag|WebSocket/ },
  { key: 'streams', route: '/bun/streams', file: 'src/research/streams-page.ts', fn: 'renderStreamsPage', keywords: /Bun\.readableStreamTo|Bun\.writableStreamTo|Bun\.fileStreamTo|ReadableStream|WritableStream|TextEncoderStream|stream/ },
  { key: 'observability', route: '/bun/observability', file: 'src/research/observability-page.ts', fn: 'renderObservabilityPage', keywords: /--cpu-prof|--heap-prof|--cpu-prof-md|memoryPressure|Bun\.natively|Bun\.ns|performance\.now|startTime|bench/ },
  { key: 'performance', route: '/bun/performance', file: 'src/research/performance-page.ts', fn: 'renderPerformancePage', keywords: /new URL|Buffer\.from|base64url|zlib|deflate|gzip|Bun\.compress|Bun\.decompress|faster|ns per|ops|benchmark|speedup/ },
  { key: 'utilities', route: '/bun/utilities', file: 'src/research/utilities-page.ts', fn: 'renderUtilitiesPage', keywords: /Bun\.stringWidth|Bun\.slice|Bun\.inspect|Bun\.deepEquals|Bun\.escapeHTML|Bun\.env|Bun\.version|Bun\.hash|Bun\.peek|Bun\.sleep|Bun\.nanoseconds/ },
  { key: 'overview', route: '/bun/overview', file: 'src/research/overview-page.ts', fn: 'renderOverviewPage', keywords: /Bun\.runtime|bun --version|Bun 1\.4|getBunVersion|Bun\.main/ },
  { key: 'tooling', route: '/bun/tooling', file: 'src/research/tooling-page.ts', fn: 'renderToolingPage', keywords: /bun --cpu-prof|bun repl|bun run|--no-orphans|--no-env-file|bun .\/README|--env-file|bunx|--inspect/ },
  { key: 'color', route: '/bun/color', file: 'src/research/color-page.ts', fn: 'renderColorPage', keywords: /Bun\.color|ANSI|color\.$/ },
  { key: 'live', route: '/bun/live', file: 'src/research/live-page.ts', fn: 'renderLivePage', keywords: /live reload|--hot|watch/ },
  { key: 'hashing', route: '/bun/hashing', file: 'src/research/hashing-page.ts', fn: 'renderHashingPage', keywords: /Bun\.CryptoHasher|Bun\.hash|sha256|md5|xxhash|Bun\.password/ },
  { key: 'pruning', route: '/bun/pruning', file: 'src/research/pruning-page.ts', fn: 'renderPruningPage', keywords: /bun prune|bun pm|node_modules.*clean|prune/ },
  { key: 'security', route: '/bun/security', file: 'src/research/security-page.ts', fn: 'renderSecurityPage', keywords: /Bun\.password|rejectUnauthorized|requestCert|X509Certificate|checkServerIdentity|servername|TLS|tls\./ },
  { key: 'speed', route: '/bun/speed', file: 'src/research/speed-page.ts', fn: 'renderSpeedPage', keywords: /benchmark|ops\/sec|faster|ms per|ns\b/ },
  { key: 'map', route: '/bun/map', file: 'src/research/map-page.ts', fn: 'renderMapPage', keywords: /Map|Set|WeakMap|WeakSet|structuredClone|identity/ },
  { key: 'markdown', route: '/bun/markdown', file: 'src/research/markdown-page.ts', fn: 'renderMarkdownPage', keywords: /Bun\.markdown|markdown\.toHTML|markdownToHTML|marked/ },
  { key: 'transpiler', route: '/bun/transpiler', file: 'src/research/transpiler-page.ts', fn: 'renderTranspilerPage', keywords: /Bun\.Transpiler|transpile|Bun\.resolveSync|Bun\.resolve/ },
  { key: 'xml', route: '/bun/xml', file: 'src/research/xml-page.ts', fn: 'renderXmlPage', keywords: /Bun\.XML|xml\.toJSON|XML/ },
  { key: 'image', route: '/bun/image', file: 'src/research/image-page.ts', fn: 'renderImagePage', keywords: /Bun\.Image|Bun\.decode|Bun\.encode|image\.resize|Bun\.inflateSync|jpeg|png|webp/ },
  { key: 'plugins', route: '/bun/plugins', file: 'src/research/plugins-page.ts', fn: 'renderPluginsPage', keywords: /Bun\.plugin|plugins|virtual module|onResolve|onLoad/ },
  { key: 'api', route: '/bun/api', file: 'src/research/api-page.ts', fn: 'renderApiPage', keywords: /Bun\.serve|Bun\.serveHTTP|api|fetch/ },
  { key: 'brand', route: '/bun/brand', file: 'src/research/brand-page.ts', fn: 'renderBrandPage', keywords: /Bun\.svg|brand|logo/ },
  { key: 'webview', route: 'brand:card CLI / WebView ground', file: 'tools/brand-card-cli.ts + src/institutions/', fn: 'webview demo', keywords: /Bun\.WebView|WebView\(|await using view/ },
  { key: 'ffi:probe', route: 'tools/ffi-probe.ts', file: 'tools/ffi-probe.ts', fn: 'ffi probe', keywords: /Bun\.ffi|dlopen|CString|cstring|ffi\./ },
  { key: 'sqlite:probe', route: 'tools/sqlite-probe.ts', file: 'tools/sqlite-probe.ts', fn: 'sqlite probe', keywords: /bun:sqlite|Database|Bun\.sql|SQL/ },
  { key: 'fs:probe', route: 'tools/fs-probe.ts', file: 'tools/fs-probe.ts', fn: 'fs probe', keywords: /Bun\.file|Bun\.write|Bun\.read|node:fs|fs\./ },
  { key: 'shell:probe', route: 'tools/shell-probe.ts', file: 'tools/shell-probe.ts', fn: 'shell probe', keywords: /Bun\.\$|glob|bun --shell|\$\`/ },
  { key: 'spawn:probe', route: 'tools/spawn-probe.ts', file: 'tools/spawn-probe.ts', fn: 'spawn probe', keywords: /Bun\.spawn|Bun\.spawnSync|cgroup|uid|gid/ },
  { key: 'net:probe', route: 'tools/net-probe.ts', file: 'tools/net-probe.ts', fn: 'net probe', keywords: /Bun\.listen|Bun\.connect|Bun\.udpSocket|dgram|node:net/ },
  { key: 'ws:probe', route: 'tools/ws-probe.ts', file: 'tools/ws-probe.ts', fn: 'ws probe', keywords: /WebSocket|ws\.|server\.publish|ws\.publish|subscriptions/ },
  { key: 'fetch:probe', route: 'tools/fetch-probe.ts', file: 'tools/fetch-probe.ts', fn: 'fetch probe', keywords: /fetch\(|Response\(|Request\(|proxy|compression|Content-Encoding|clone\(\)|X-Dup|bodyUsed/ },
  { key: 'crypto:probe', route: 'tools/crypto-probe.ts', file: 'tools/crypto-probe.ts', fn: 'crypto probe', keywords: /crypto\.|CryptoHasher|X509Certificate|subtle|SHA-3|ML-DSA|ML-KEM/ },
  { key: 'h2:probe', route: 'tools/h2-probe.ts', file: 'tools/h2-probe.ts', fn: 'h2 probe', keywords: /http2|HTTP\/2/ },
  { key: 'serve:probe', route: 'tools/serve-probe.ts', file: 'tools/serve-probe.ts', fn: 'serve probe', keywords: /Bun\.serve\(|server\.stop|server\.publish|routes/ },
  { key: 'serve-stream:probe', route: 'tools/serve-stream-probe.ts', file: 'tools/serve-stream-probe.ts', fn: 'stream probe', keywords: /ReadableStream|stream|backpressure|pull|TextEncoderStream/ },
  { key: 'transpiler:probe', route: 'tools/transpiler-probe.ts', file: 'tools/transpiler-probe.ts', fn: 'transpiler probe', keywords: /Transpiler|transpile/ },
  { key: 'xml:probe', route: 'tools/xml-probe.ts', file: 'tools/xml-probe.ts', fn: 'xml probe', keywords: /Bun\.XML|XML/ },
  { key: 'image:probe', route: 'tools/image-probe.ts', file: 'tools/image-probe.ts', fn: 'image probe', keywords: /Bun\.Image|decode|encode|resize/ },
  { key: 'format:probe', route: 'tools/format-probe.ts', file: 'tools/format-probe.ts', fn: 'format probe', keywords: /Bun\.stringWidth|format|ANSI/ },
  { key: 'runtime:probe', route: 'tools/runtime-probe.ts', file: 'tools/runtime-probe.ts', fn: 'runtime probe', keywords: /Bun\.runtime|Bun\.version|process\.versions|NODE_MODULE_VERSION/ },
  { key: 'node-compat:probe', route: 'tools/node-compat-probe.ts', file: 'tools/node-compat-probe.ts', fn: 'node compat probe', keywords: /node:|node:http|node:fs|node:net|node:worker|node:vm|node:cluster|node:sqlite|writeHead|requestCert|NODE_MODULE_VERSION/ },
  { key: 'serve-tls:probe', route: 'tools/serve-tls-probe.ts', file: 'tools/serve-tls-probe.ts', fn: 'tls probe', keywords: /tls\.|rejectUnauthorized|requestCert|servername|X509/ },
  { key: 'deps:diff', route: 'tools/deps-diff.ts', file: 'tools/deps-diff.ts', fn: 'deps diff', keywords: /bun pm diff|lockfile|dependencies diff/ },
  { key: 'bun-install', route: 'bun install', file: 'package.json scripts', fn: 'bun install', keywords: /bun install|bun add|bun remove|bun update|bun pm|lockfile|isolated linker|virtual store/ },
  { key: 'bun-test', route: 'bun test', file: 'package.json scripts + tools', fn: 'bun test', keywords: /bun test|bun test --|test\(|describe\(|it\(|jest\.|vi\.|expect\(/ },
  { key: 'bun-build', route: 'bun build', file: 'tools/build-probe.ts', fn: 'bun build', keywords: /bun build|Bun\.build|--compile|--target|--minify|--sourcemap|--define|metafile|decorator|--asset|kind,\s*name|@logged/ },
  { key: 'bun-cron', route: 'cron channel + live-channel', file: 'src/lib/blog-map-run.ts (cron)', fn: 'signal-pipeline cron', keywords: /Bun\.cron|cron\(/ },
  { key: 'bun-yaml-toml-json5', route: 'tools/bun-apis-probe.ts', file: 'tools/bun-apis-probe.ts', fn: 'bun-apis probe', keywords: /Bun\.YAML|Bun\.TOML|Bun\.JSON5|Bun\.JSONL|Bun\.JSONC|Bun\.XML/ },
  { key: 'bun-mmap', route: 'tools/fs-probe.ts', file: 'tools/fs-probe.ts', fn: 'fs probe (mmap)', keywords: /Bun\.mmap|setKeepAlive/ },
  { key: 'bun-s3', route: 'tools/net-probe.ts', file: 'tools/net-probe.ts', fn: 'net probe (s3)', keywords: /Bun\.S3Client|S3Client/ },
  { key: 'bun-ansi', route: 'tools/format-probe.ts', file: 'tools/format-probe.ts', fn: 'format probe', keywords: /Bun\.wrapAnsi|Bun\.sliceAnsi|Bun\.stringWidth/ },
  { key: 'bun-sql-tag', route: 'tools/sqlite-probe.ts', file: 'tools/sqlite-probe.ts', fn: 'sqlite probe', keywords: /sql\`|sql\.json|MySQL|MariaDB/ },
  { key: 'install', route: 'bun install (install docs)', file: 'docs + package.json', fn: 'install', keywords: /bun\.sh\/install|npm install -g bun|brew install oven-sh|bun upgrade|curl -fsSL https:\/\/bun\.sh/ },
  { key: 'install-config', route: 'bun install (bunfig)', file: 'bunfig.toml + docs', fn: 'install config', keywords: /trustedDependencies|nativeDependencies|ignoreScripts|overrides|hoistPattern|public-hoist|bunfig\.toml|\[install\]|sourcemap|\[serve\.static\]/ },
  { key: 'node-repl', route: 'bun repl / --interactive', file: 'bun CLI', fn: 'repl', keywords: /bun --interactive|bun repl/ },
  { key: 'trace-events', route: 'bun --trace-events', file: 'bun CLI', fn: 'trace events', keywords: /--trace-events|node_trace/ },
  { key: 'compile-cache', route: 'NODE_COMPILE_CACHE', file: 'bun CLI env', fn: 'compile cache', keywords: /NODE_COMPILE_CACHE|compile-cache/ },
  { key: 'execute-only', route: 'bun build --compile', file: 'tools/build-probe.ts', fn: 'build probe', keywords: /chmod 111|execute-only|__using|using / },
  { key: 'vitest', route: 'bun --bun vitest', file: 'bun test + vitest', fn: 'vitest', keywords: /vitest|--coverage/ },
  { key: 'temporal', route: 'tools/runtime-probe.ts', file: 'tools/runtime-probe.ts', fn: 'runtime probe', keywords: /ZonedDateTime|Instant/ },
  { key: 'node-trace', route: 'tools/node-compat-probe.ts', file: 'tools/node-compat-probe.ts', fn: 'node compat probe', keywords: /node:trace_events|trace_events|node:repl/ },
];

// heading-level explicit overrides (headings whose blocks don't self-describe)
const OVERRIDES: Record<string, string> = {
  'async-stack-traces-from-native-i-o': 'tools/fs-probe.ts (node:fs error stack traces)',
  'process': 'tools/node-compat-probe.ts (node:process changelog)',
};

export function matchDemo(code: string): Demo | null {
  for (const d of DEMOS) if (d.keywords.test(code)) return d;
  return null;
}

// ------------------------------------------------------------- build report
interface BlockRow {
  n: number;
  section: string;
  headingId: string;
  headingTitle: string;
  kind: string;
  status: string;
  claims: string;
  firstLine: string;
  demo: string;
  mapped: 'registry' | 'content' | 'uncovered';
}

const rows: BlockRow[] = [];
const bySection = new Map<string, { covered: number; uncovered: number }>();
let covered = 0;
let uncovered = 0;

for (let i = 0; i < pres.length; i++) {
  const h = headingFor(i);
  const code = preText(pres[i]!);
  const ledger = ledgerRows.get(i);
  const kind = ledger?.kind ?? '';
  const status = ledger?.status ?? 'UNVERIFIED';
  const claims = ledger?.claims ?? '';
  const firstLine = code.split('\n').find((l) => l.trim())?.trim().slice(0, 60) ?? '';
  const regEntry = registryById.get(h.id);

  // heading-level demo: registry mapping first; else match the heading against
  // ALL its code blocks concatenated (an output/result block inherits its paired
  // code block's demo). Output/other blocks share the heading's demo.
  const headingDemoCache = new Map<string, { demo: string; mapped: BlockRow['mapped'] }>();
  const headingKey = h.id;
  let hd = headingDemoCache.get(headingKey);
  if (!hd) {
    const re = regEntry && regEntry.mappedTo && regEntry.mappedTo !== 'NOT mapped';
    if (re) {
      hd = { demo: regEntry.mappedTo, mapped: 'registry' };
    } else if (OVERRIDES[headingKey]) {
      hd = { demo: OVERRIDES[headingKey], mapped: 'content' };
    } else {
      const all = pres
        .map((p, k) => ({ p, k }))
        .filter((x) => headingFor(x.k).id === headingKey)
        .map((x) => preText(x.p))
        .join('\n');
      const d = matchDemo(all || code);
      if (d) hd = { demo: d.route + ' (' + d.file + ')', mapped: 'content' };
      else hd = { demo: '', mapped: 'uncovered' };
    }
    headingDemoCache.set(headingKey, hd);
  }
  let demo = hd.demo;
  let mapped: BlockRow['mapped'] = hd.mapped;
  if (demo) covered++;
  else uncovered++;
  const sec = regEntry?.section ?? '?';
  const s = bySection.get(sec) ?? { covered: 0, uncovered: 0 };
  if (demo) s.covered++;
  else s.uncovered++;
  bySection.set(sec, s);

  rows.push({ n: i, section: sec, headingId: h.id, headingTitle: h.title, kind, status, claims, firstLine, demo, mapped });
}

// write JSON
const outJson = { total: pres.length, covered, uncovered, coveragePct: Math.round((covered / pres.length) * 100), rows };
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'blog-coverage-map.json'), JSON.stringify(outJson, null, 2) + '\n');

// write markdown
const md: string[] = [
  '# Bun 1.4 blog → demo coverage map',
  '',
  pres.length + ' code blocks extracted · ' + covered + ' mapped to an existing demo route/function · ' + uncovered + ' uncovered (' + outJson.coveragePct + '% covered)',
  '',
  '## By section',
  '| section | covered | uncovered |',
  '|---|---|---|',
];
for (const [sec, c] of [...bySection.entries()].sort()) {
  md.push('| ' + sec + ' | ' + c.covered + ' | ' + c.uncovered + ' |');
}
md.push('', '## Uncovered blocks (need a demo or a registry mapping)', '', '| # | section | heading | kind | first line |', '|---|---|---|---|---|');
let u = 0;
for (const r of rows) {
  if (!r.demo) {
    md.push('| ' + r.n + ' | ' + r.section + ' | ' + r.headingId + ' | ' + r.kind + ' | ' + r.firstLine.replace(/\|/g, '\\|') + ' |');
    u++;
  }
}
md.push('', 'Uncovered: ' + u, '');
writeFileSync(join(OUT_DIR, 'blog-coverage-map.md'), md.join('\n') + '\n');

console.log('blog:coverage — ' + pres.length + ' blocks · ' + covered + ' covered · ' + uncovered + ' uncovered · ' + outJson.coveragePct + '%');
console.log('output: research/outputs/blog-coverage-map.json + blog-coverage-map.md');
