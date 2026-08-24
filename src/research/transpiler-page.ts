/**
 * transpiler-page.ts — /bun/transpiler: the Bun.Transpiler reference,
 * with Import.kind SEPARATED + highlighted (the docs' kind list, probed
 * §47-§50). Token-built audited page.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED, W_NOTE } from '../lib/widget-page.ts';

export function renderTranspilerPage(): string {
  const kinds = widgetTable(['kind', 'Example', 'Probe'], [
    { cells: ['<code><strong>import-statement</strong></code>', '<code>import React from \'react\'</code>', W_VERIFIED + ' scan()/scanImports() emit it'] },
    { cells: ['<code><strong>require-call</strong></code>', '<code>const val = require(\'./cjs.js\')</code>', W_VERIFIED + ' scan() emits it'] },
    { cells: ['<code><strong>require-resolve</strong></code>', '<code>require.resolve(\'./cjs.js\')</code>', W_CORRECTED + ' ONLY in scan().imports — scanImports() DROPS it (probe §47)'] },
    { cells: ['<code><strong>dynamic-import</strong></code>', '<code>import(\'./loader\')</code>', W_VERIFIED + ' both methods emit it'] },
    { cells: ['<code><strong>import-rule</strong></code>', '<code>@import \'foo.css\'</code>', W_CORRECTED + ' CSS — Bun.Transpiler CANNOT scan CSS (all loaders throw §47); bundler-only'] },
    { cells: ['<code><strong>url-token</strong></code>', '<code>url(\'./foo.png\')</code>', W_CORRECTED + ' CSS — same: not reachable via Bun.Transpiler; bundler-only'] },
    { cells: ['<code><strong>internal</strong></code>', 'injected by Bun', W_NOTE + ' not from source scanning'] },
    { cells: ['<code><strong>entry-point-build</strong></code> / <strong>entry-point-run</strong>', 'entry points', W_NOTE + ' not from source scanning'] },
  ]);
  const api = widgetTable(['API', 'Probe'], [
    { cells: ['<code>new Bun.Transpiler({ loader })</code>', W_VERIFIED + ' ctor loader fixes scan() for TS (§49)'] },
    { cells: ['<code>transformSync / transform</code>', W_VERIFIED + ' ts/js/tsx; define/inline/minify/trim/exports verified (§48)'] },
    { cells: ['<code>scan() → {exports, imports}</code>', W_VERIFIED + ' full import list incl. require-resolve; type-only imports/exports IGNORED with loader:tsx (§52)'] },
    { cells: ['<code>scanImports()</code>', W_CORRECTED + ' faster but drops require-resolve (§47)'] },
    { cells: ['<code>macro</code>', W_VERIFIED + ' fn-call form works; template-literal form THROWS in 1.4.0 (§50)'] },
  ]);
  const opts = widgetTable(['Option', 'Probe'], [
    { cells: ['<code>define / loader / target / tsconfig</code>', W_VERIFIED + ' define+loader+tsconfig verified; target is a NO-OP in the transpiler (§48)'] },
    { cells: ['<code>treeShaking / trimUnusedImports</code>', W_VERIFIED + ' both drop unused imports'] },
    { cells: ['<code>inline / minifyWhitespace / replMode</code>', W_VERIFIED + ' constant folding / minify / REPL wrap (§50)'] },
    { cells: ['<code>exports.eliminate / replace</code>', W_VERIFIED + ' removes + renames exports'] },
    { cells: ['<code>deadCodeElimination</code>', W_NOTE + ' no observable difference on a dead-const sample (§50)'] },
  ]);
  return renderWidgetPage({
    title: 'Bun.Transpiler Reference',
    subtitle: 'Import.kind separated + highlighted — every documented value probed against Bun 1.4.0',
    badges: ['8 kinds', 'separated', 'highlighted', 'probed §47-50'],
    links: ['/bun/overview', '/bun/speed', '/bun/markdown'],
    sections: [
      { heading: 'Import.kind (the reference)', html: kinds },
      { heading: 'API surface', html: api },
      { heading: 'Options', html: opts },
    ],
    footer: 'Full probe matrix: docs/AGENT-PITFALLS.md §47-50 · page: src/research/transpiler-page.ts',
  });
}