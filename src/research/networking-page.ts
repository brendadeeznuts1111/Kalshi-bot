/**
 * networking-page.ts — /bun/networking: the Bun.Networking deep-dive widget,
 * token-built (audited surface). Every capability claim carries a probe
 * status: verified against Bun 1.4.0 in this repo, corrected where the
 * marketing copy overstates (req.file(), Response(Bun.file(html)) bundling),
 * or noted as Bun-internal/unverifiable (benchmarks).
 */
import { BRAND, DESIGN_SYSTEM_VERSION } from '../institutions/design-tokens.ts';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>\"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

type Row = { cells: string[]; cls?: string };

function table(headers: string[], rows: Row[]): string {
  const head = headers.map((h) => '<th>' + esc(h) + '</th>').join('');
  const body = rows
    .map((r) =>
      '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '>' + r.cells.map((c) => '<td>' + c + '</td>').join('') + '</tr>',
    )
    .join('');
  return '<table><tr>' + head + '</tr>' + body + '</table>';
}

const ok = '<span class="badge ok">verified</span>';
const bad = '<span class="badge bad">corrected</span>';
const warn = '<span class="badge warn">note</span>';

export function renderNetworkingPage(): string {
  const depRows: Row[] = [
    { cells: ['<code>express</code> + <code>http</code>', '2.8 MB', '47', 'router + middleware chain'] },
    { cells: ['<code>serve-static</code> / <code>send</code>', '0.5 MB', '12', 'static files, ranges'] },
    { cells: ['<code>ws</code>', '1.2 MB', '5', 'real-time upgrades'] },
    { cells: ['<code>node:net</code> + <code>node:dgram</code>', 'built-in', '0', 'callback-heavy, no backpressure'] },
    { cells: ['<code>vite</code> / <code>webpack</code> dev server', '30+ MB', '100+', 'separate pipeline, HMR'] },
    { cells: ['<strong>Total replaced by Bun 1.4</strong>', '<strong>&gt; 35 MB</strong>', '<strong>&gt; 160</strong>', 'one runtime, zero deps'], cls: 'tot' },
  ];
  const depMath = table(['What you would install', 'Size', 'Transitive deps', 'Notes'], depRows);

  const primRows: Row[] = [
    { cells: ['<code>Bun.listen()</code> — TCP + TLS', 'raw socket server, socket.reload() hot-swap', ok] },
    { cells: ['<code>Bun.udpSocket()</code> — UDP + multicast', 'addMembership / setMulticastTTL / send', ok] },
    { cells: ['<code>http3: true</code> — QUIC', 'requires tls (probe: throws without it); Alt-Svc upgrade', warn] },
    { cells: ['<code>req.file()</code> — multipart upload', 'does not exist in 1.4.0 — use req.formData()', bad] },
    { cells: ['Response(Bun.file(html)) — bundles HTML?', 'serves raw bytes; bundling is via HTML imports', bad] },
    { cells: ['<code>routes</code> — static / param / wildcard', 'exact &gt; param &gt; wildcard; req.params', ok] },
    { cells: ['<code>{ dir }</code> static + Range/206', 'sendfile zero-copy, ETag/304, content-type from extension', ok] },
  ];
  const prims = table(['Primitive', 'Claim', 'Probe'], primRows);

  const archRows: Row[] = [
    { cells: ['Event loop', 'io_uring (Linux) / kqueue (macOS) — Bun internal'] },
    { cells: ['File serving', 'sendfile(2) zero-copy — VERIFIED in-repo (dir routes, 206, ETag/304)'] },
    { cells: ['Routing', 'compiled matcher (Bun internal — O(1) claim unverified)'] },
    { cells: ['TLS', 'rejectUnauthorized default; BoringSSL (Bun internal)'] },
    { cells: ['HTTP/3', 'experimental, TLS-required; no in-repo certs to exercise'] },
  ];
  const arch = table(['Layer', 'Status'], archRows);

  const secRows: Row[] = [
    { cells: ['Path traversal', 'openat2 O_RESOLVE_BENEATH — VERIFIED in-repo (dir routes 404 traversal)'] },
    { cells: ['Param-route traversal', 'hand-rolled :id routes must self-validate (isSafeVideoId)'] },
    { cells: ['HTML-inlining trap', 'relative video/script in HTML imports inlined as data: URLs'] },
  ];
  const sec = table(['Area', 'Status'], secRows);

  const fetchSec = table(['fetch() capability', 'Probe'], [
    { cells: ['<code>compress</code> — gzip/deflate/br/zstd request bodies', ok + ' POST gzip -> content-encoding:gzip (47 B), br -> 27 B'] },
    { cells: ['<code>protocol: "http2" | "http3"</code>', warn + ' documented (needs an h2/h3 peer to exercise)'] },
    { cells: ['TLS session resumption (1-RTT, 32-entry LRU)', warn + ' BoringSSL internals — not probed locally'] },
    { cells: ['proxy headers (Proxy-Authorization etc.)', warn + ' option shape accepted; needs a real proxy to exercise'] },
  ]);

  const used = [
    'Bun.serve routing (exact / param / wildcard dir) — /videos, /brand, /registry, /partner-dashboard',
    'Bun.file bodies + dir routes — Range/206 seeking, ETag/304, content-type from extension',
    'HTML imports + development.hmr — the live /hq page (bundled, HMR, console forwarding)',
    'Bun.WebView + Bun.Image — brand card raster, snapshots, image metadata/conversion',
    'Bun.color / Bun.markdown / Bun.Glob / Bun.spawn — the design pipeline',
  ];

  return '<!DOCTYPE html>' +
    '<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>' + esc(BRAND.name) + ' — Bun.Networking deep dive</title>' +
    '<link rel="stylesheet" href="/design-system.css" />' +
    '<style>' +
    'body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, \"SF Pro Text\", Segoe UI, sans-serif; padding: 2rem 2.5rem 4rem; }' +
    'header { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }' +
    'header h1 { margin: 0; font-size: 1.25rem; letter-spacing: 0.04em; }' +
    'header h1 span { color: var(--acc); }' +
    'header p { color: var(--dim); font-size: 0.8rem; margin: 0.3rem 0 0; }' +
    'section { margin-bottom: 2rem; }' +
    'h2 { font-size: 1rem; margin: 0 0 0.6rem; }' +
    'table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }' +
    'th, td { text-align: left; padding: 0.45rem 0.65rem; border-bottom: 1px solid var(--line); vertical-align: top; }' +
    'th { color: var(--dim); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }' +
    'tr.tot td { border-top: 2px solid var(--line); }' +
    'code { font-family: var(--mono); font-size: 0.8rem; color: var(--acc); }' +
    'ul { margin: 0.4rem 0; padding-left: 1.2rem; }' +
    'li { margin: 0.25rem 0; }' +
    'a { color: var(--acc); }' +
    'footer { color: var(--dim); font-size: 0.75rem; margin-top: 2rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }' +
    '</style></head><body>' +
    '<header><h1>' + esc(BRAND.name) + ' <span>· Bun.Networking deep dive</span></h1>' +
    '<p>Bun ' + esc(Bun.version) + ' · probe-verified capability table · design v' + esc(DESIGN_SYSTEM_VERSION) + ' · <a href="/bun/streams">streams</a> · <a href="/bun/observability">observability</a> · <a href="/bun/performance">performance</a> · <a href="/design">design</a> · <a href="/design/trend">trend</a> · <a href="/videos">videos</a></p></header>' +
    '<section><h2>1 · The dependency math</h2>' + depMath + '<p class="muted">One runtime for TCP, UDP, TLS, HTTP/1.1, HTTP/3, routing, bundling, hot reload — the same routes object in dev (--hot) and prod.</p></section>' +
    '<section><h2>2 · The primitives (probed in Bun 1.4.0)</h2>' + prims + '</section>' +
    '<section><h2>3 · Architecture &amp; performance</h2>' + arch + '<p class="muted">Marketing benchmarks (34k req/s static, 72k JSON, 12ms cold start) are not independently verified here — what IS verified: zero-copy sendfile serving, Range/206, ETag/304, traversal protection.</p></section>' +
    '<section><h2>4 · Security &amp; conformance</h2>' + sec + '</section>' +
    '<section><h2>5 · Hot reload / dev-prod parity</h2><ul>' + used.map((u) => '<li>' + u + '</li>').join('') + '</ul></section>' +
    '<section><h2>6 · fetch client (protocol, compression, sessions)</h2>' + fetchSec + '</section>' +
    '<footer>The dependency-killer story: express + serve-static + ws + vite/webpack + node:net collapse into one API. Probes live in docs/AGENT-PITFALLS.md §15 + §17.</footer>' +
    '</body></html>';
}
