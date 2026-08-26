/**
 * map-page.ts — /bun/map: every h3/h4 heading under ALL 13 blog sections
 * (registry v2, §184) mapped to THIS repo: file/script, then which
 * integration layer it touches (channels / branding / pipeline / data).
 * Token-built audited page.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_MARKETING, W_NOTE } from '../lib/widget-page.ts';

export function renderMapPage(): string {
  // ── faster ──
  const faster = widgetTable(['Sub-header (id)', 'Mapped to', 'Layer'], [
    { cells: ['<code>new-url-is-up-to-4-6-faster</code>', 'serve.ts routes (new URL), patterns.ts URLPattern — absolute 1.4 measurement 52/73/2 ns; ratio not reproduced', 'pipeline · channels'] },
    { cells: ['<code>faster-regexp</code>', 'design scanner hex regex micro-bench (4.84ms/200k×20) — blog isbot/marked numbers NOT reproduced', 'pipeline · note'] },
    { cells: ['<code>node-zlib-uses-zlib-ng</code>', 'Bun.deflateSync speed measured — zlib-ng IMPLEMENTATION claim not verified', 'pipeline · note'] },
    { cells: ['<code>buffer-from-str-hex-is-8-faster-and-base64url-46-faster</code>', 'color kernel hex math (manual, not Buffer) — no direct consumer', 'branding'] },
    { cells: ['<code>source-map-decoding-is-3-1-faster</code>', 'NOT probed — runtime-wide sourcemap decode, no measured evidence in-repo', 'ops · note'] },
    { cells: ['<code>promises-are-1-5-2-4-faster</code>', 'NOT probed — runtime-wide, no measured evidence in-repo', 'all · note'] },
  ]);
  // ── bun-build ──
  const build = widgetTable(['Sub-header', 'Mapped to', 'Layer'], [
    { cells: ['<code>built-in-react-compiler</code>', 'NOT mapped — no React/TSX in repo; option verified functional (§29)', '—'] },
    { cells: ['<code>barrel-import-optimization</code>', 'NOT mapped — default tree-shaker already wins on pure ESM (§29)', '—'] },
    { cells: ['<code>compile-time-feature-flags-with-bun-bundle</code>', 'NOT used as module; --define feature flags VERIFIED (probe: FEATURE_FLAG->enabled)', 'pipeline'] },
    { cells: ['<code>in-memory-files-in-bun-build</code>', 'plugin virtual modules VERIFIED (probe: tests/bun-plugin-namespaces.test.ts; doc: bundler-plugins.mdx §Namespaces)', 'pipeline'] },
    { cells: ['<code>single-file-html-with-compile-target-browser</code>', 'NOT mapped — serve.ts serves HTML directly, no compiled single-file', '—'] },
    { cells: ['<code>metafile-true</code>', 'YES — dist/*.meta.json feeds design budgets (design-budget.ts)', 'pipeline · channels(design)'] },
    { cells: ['<code>metafile-md</code>', 'YES — dist/*.meta.md is the mtafile (design:build --metafile-md)', 'pipeline · channels(design)'] },
    { cells: ['<code>standard-tc39-decorators</code>', 'NOT mapped — no decorators in repo', '—'] },
    { cells: ['<code>asset</code>', 'NOT mapped — no asset pipeline', '—'] },
    { cells: ['<code>bytecode-compilation-for-es-modules</code>', 'NOT mapped — no --compile/bytecode in repo', '—'] },
    { cells: ['<code>code-splitting-on-20-000-module-graphs-is-14-faster</code>', W_MARKETING + ' — no 20k-module graph in-repo', '—'] },
  ]);
  // ── bun-test ──
  const test = widgetTable(['Sub-header', 'Mapped to', 'Layer'], [
    { cells: ['<code>bun-test-parallel</code>', 'YES — test:parallel, test: (--parallel)', 'pipeline · channels(deps)'] },
    { cells: ['<code>bun-test-isolate</code>', 'YES — test:parallel, test:isolate', 'pipeline'] },
    { cells: ['<code>bun-test-shard</code>', 'YES — test:shard (TEST_SHARD env)', 'pipeline'] },
    { cells: ['<code>bun-test-timings</code>', 'YES — test: + .bun-test-timings.json', 'pipeline'] },
    { cells: ['<code>bun-test-changed</code>', 'YES — test:changed, pre-commit --changed', 'pipeline'] },
    { cells: ['<code>bun-test-retry</code>', 'YES — pre-commit --retry 1 (rotate-key flake)', 'pipeline'] },
    { cells: ['<code>jest-usefaketimers</code>', W_NOTE + ' — available, not yet used (§20)', 'pipeline'] },
  ]);
  // ── bun-install ──
  const install = widgetTable(['Sub-header', 'Mapped to', 'Layer'], [
    { cells: ['<code>global-virtual-store-up-to-7x-faster-installs</code>', 'YES — bunfig linker="isolated" (global virtual store)', 'deps'] },
    { cells: ['<code>bun-pm-diff</code>', 'YES — deps:diff (tools/deps-diff.ts)', 'channels(deps)'] },
    { cells: ['<code>bun-audit-fix</code>', 'YES — deps:audit-fix:dry', 'channels(deps)'] },
    { cells: ['<code>bun-dedupe</code>', 'YES — deps:check (dedupe --check)', 'channels(deps)'] },
    { cells: ['<code>bun-prune</code>', 'YES — deps:prune(:prod) + content:prune (§25-27)', 'channels(deps+prune)'] },
    { cells: ['<code>bun-pm-licenses</code>', 'YES — licenses:check', 'channels(deps)'] },
    { cells: ['<code>bun-update-updates-transitive-dependencies</code>', W_NOTE + ' — not run here (frozenLockfile)', 'deps'] },
    { cells: ['<code>bun-add-filter / catalog / nested-overrides / trustedDependencies / nativeDependencies</code>', 'NOT mapped — 3-dep repo, no monorepo/overrides', '—'] },
    { cells: ['<code>lockfile-integrity-for-github-and-tarball-dependencies</code>', 'NOT mapped — no git/tarball deps (file: proton-pass only)', '—'] },
  ]);
  // ── what-s-new ──
  const whatsNew = widgetTable(['Sub-header', 'Mapped to', 'Layer'], [
    { cells: ['<code>bun-image</code>', 'YES — brand-image.ts, /brand/* routes, images:meta', 'brand · pipeline'] },
    { cells: ['<code>bun-webview</code>', 'YES — brand:card CLI (ground tool), §18', 'brand'] },
    { cells: ['<code>bun-markdown</code>', 'YES — content-pipeline renderMarkdownBody + release-blog (§27)', 'pipeline · channels(releases)'] },
    { cells: ['<code>bun-cron</code>', 'YES — signal-pipeline cron channel + live-channel hourly feed', 'channels(cron)'] },
    { cells: ['<code>bun-terminal</code>', W_NOTE + ' — exists, PTY-only ("Failed to open PTY" under capture); terminal.ts paint uses ANSI', 'ops'] },
    { cells: ['<code>bun-run-parallel</code>', 'NOT mapped — no parallel npm scripts', '—'] },
    { cells: ['<code>3x-faster-bun-ffi</code>', 'ffi:probe CLI (dlopen verified) — the 3x speedup NOT measured', 'ops'] },
    { cells: ['<code>dev-tooling</code>', 'YES — serve.ts development HMR/console (§15)', 'ops'] },
    { cells: ['<code>http-3-in-bun-serve-experimental</code>', W_VERIFIED + ' http3:true works — Alt-Svc h3=:port ma=86400 advertised (probe); upgrade() false over H3 per docs', 'ops'] },
    { cells: ['<code>http-2-http-3-in-fetch-experimental</code>', W_VERIFIED + ' fetch(protocol:http2) -> 200 to bun.sh (probe)', 'ops'] },
    { cells: ['<code>serve-files-folders</code>', 'dir routes: sendfile + weak ETag (W/) + Last-Modified + 304 + 206 (verified)', 'ops · pipeline'] },
    { cells: ['<code>range-and-conditional-requests</code>', 'dir-route conditionals verified: Range->206, If-None-Match->304, If-Match weak->412 / *->200, If-Unmodified-Since past->412; bare Response(Bun.file) does NOT auto-etag', 'ops · pipeline'] },
    { cells: ['<code>html-routes-sourcemaps-disabled-in-production</code>', 'VERIFIED natively: NODE_ENV=production /design HTML route has no sourcemap refs + no dev markers', 'ops'] },
    { cells: ['<code>fetch-request-compression</code>', 'compress string + object {encoding,level} verified (gzip 5000B->55B)', 'data'] },
    { cells: ['<code>fetch-proxy-headers</code>', W_NOTE + ' — documented, no proxy in-repo (§17)', 'data'] },
    { cells: ['<code>tls-session-resumption</code>', W_NOTE + ' — BoringSSL internal (§17)', 'data'] },
    { cells: ['<code>connection-reuse</code>', 'YES — fetch-pool.ts', 'data'] },
    { cells: ['<code>also-built-in</code>', 'YES — the sharp/puppeteer/marked/… list maps file-by-file (Bun.Image/WebView/markdown/…)', 'all'] },
  ]);
  return renderWidgetPage({
    title: 'Blog → Repo Map',
    subtitle: 'Every sub-header under #faster #bun-build #bun-test #bun-install #what-s-new → file → integration layer',
    badges: ['45 sub-headers', 'layers: channels/brand/pipeline/data'],
    links: ['/bun/overview', '/bun/speed', '/bun/tooling', '/bun/security', '/bun/api', '/bun/brand'],
    sections: [
      { heading: '#faster sub-headers', html: faster },
      { heading: '#bun-build sub-headers', html: build },
      { heading: '#bun-test sub-headers', html: test },
      { heading: '#bun-install sub-headers', html: install },
      { heading: '#what-s-new sub-headers', html: whatsNew },
      { heading: 'Integration layers', html: '<ul><li><strong>channels</strong>: design/deps/brand/releases/ops/inventory/cron/prune/mapping/docs/compliance/github signals on /dashboard (registry-driven, live-refresh)</li><li><strong>branding</strong>: TOKENS + design-system bundle (the one-vocabulary audit)</li><li><strong>pipeline</strong>: content (hash/frontmatter/ETag) + build (metafiles/budgets) + prune (.trash/archive/restore)</li><li><strong>data</strong>: massey/event-store/registry + fetch compression/reuse</li></ul>' },
    ],
    footer: 'Full mapping: docs/AGENT-PITFALLS.md §30 · tracker: bun:blog-map + mapping channel (§31) · our own markdown anchors are NATIVE via Bun.markdown { headings: { ids: true } } (§33 — corrected; §32 probed wrong option names)',
  });
}
