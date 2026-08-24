/**
 * speed-page.ts — /bun/speed: the Faster / build / test / install claims
 * from the release blog, probed against the installed runtime
 * (docs/AGENT-PITFALLS.md §29). Token-built audited page.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_MARKETING, W_NOTE } from '../lib/widget-page.ts';

export function renderSpeedPage(): string {
  const url = widgetTable(['Operation', 'Blog (1.3 -> 1.4)', 'Measured here', 'Status'], [
    { cells: ['<code>new URL(absolute)</code>', '349 ns -> 75 ns (4.6×)', '52 ns/op', W_VERIFIED + ' absolute 1.4 measurement on this machine — the 1.3 baseline + ratio NOT independently reproduced'] },
    { cells: ['<code>new URL(relative, base)</code>', '523 ns -> 168 ns (3.1×)', '73 ns/op', W_VERIFIED + ' absolute 1.4 measurement — ratio not reproduced'] },
    { cells: ['<code>url.href</code>', '16 ns -> 5 ns', '2 ns/op', W_VERIFIED + ' absolute 1.4 measurement — ratio not reproduced'] },
    { cells: ['href reuses input / punycode skip', 'documented', 'href === input; münchen.de -> xn--mnchen-3ya.de', W_VERIFIED] },
  ]);
  const build = widgetTable(['Option', 'Probe'], [
    { cells: ['<code>reactCompiler: true</code> / <code>--react-compiler</code>', W_VERIFIED + ' option real; compiles and injects react/compiler-runtime (memoization) — the option RUNS'] },
    { cells: ['React compiler speed (19-20× vs Babel)', W_MARKETING + ' needs a React codebase to measure; not probed in-repo (no React)'] },
    { cells: ['<code>optimizeImports: ["pkg"]</code>', W_VERIFIED + ' option accepted; on pure-ESM barrels the DEFAULT tree-shaker already drops unused exports (no observable diff)'] },
    { cells: ['barrel optimization value', W_NOTE + ' targets side-effectful packages (no sideEffects:false) — not reproducible with pure ESM fixtures'] },
    { cells: ['<code>jsx</code> option shape', W_VERIFIED + ' must be an OBJECT ({ runtime, factory }) — a bare string throws TypeError (probe)'] },
  ]);
  const testFlags = widgetTable(['Flag', 'Probe'], [
    { cells: ['<code>--parallel=<N></code>', W_VERIFIED + ' defaults to CPU count, implies --isolate, --parallel-delay (default 5ms)'] },
    { cells: ['<code>--shard=M/N</code>', W_VERIFIED + ' CI split (repo: test:shard, TEST_SHARD env)'] },
    { cells: ['<code>--timings</code> + <code>--update-timings</code>', W_VERIFIED + ' balances shards + starts slowest first; repo uses --timings in test script'] },
    { cells: ['<code>--changed=main</code>', W_VERIFIED + ' only diff-touched files; repo pre-commit uses --changed'] },
  ]);
  const install = widgetTable(['Claim', 'Probe'], [
    { cells: ['many times faster than npm/pnpm/yarn', W_MARKETING + ' vendor benchmarks (T3 app, 25 deps); NOT reproducible without the exact app'] },
    { cells: ['no-op reinstall', W_VERIFIED + ' "Checked 1 package (no changes) [1.00ms]" on an empty app — the no-op path is real and fast'] },
  ]);
  return renderWidgetPage({
    title: 'Speed & Tooling Claims',
    subtitle: 'The faster / bun build / bun test / bun install sections of the 1.4 blog — probed',
    badges: ['new URL', 'reactCompiler', 'tree-shaking', 'test flags'],
    links: ['/bun/overview', '/bun/performance', '/bun/tooling', '/bun/security'],
    sections: [
      { heading: 'new URL() (faster)', html: url },
      { heading: 'bun build (reactCompiler + barrel imports)', html: build },
      { heading: 'bun test flags', html: testFlags },
      { heading: 'bun install', html: install },
      { heading: 'what-s-new', html: '<p class="muted">The "15 dependencies · now built in 0" animation lists sharp / puppeteer / marked / node-cron / node-pty / concurrently / npm-run-all / serve-static / json5 / fast-xml-parser — the repo replaces these with Bun builtins (Bun.Image, Bun.WebView, Bun.markdown, Bun.cron, Bun.spawn, dir routes, Bun.JSON5, Bun.XML) — see /bun/overview for the full replacement table.</p>' },
    ],
    footer: 'Probes: docs/AGENT-PITFALLS.md §29 · probe scripts in this turn',
  });
}
