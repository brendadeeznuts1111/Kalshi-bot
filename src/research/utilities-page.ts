/**
 * utilities-page.ts — /bun/utilities: the Built-in Utilities widget, with
 * per-utility probe status (verified / note). Token-built audited surface.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_NOTE, W_MARKETING } from '../lib/widget-page.ts';

export function renderUtilitiesPage(): string {
  const rows = widgetTable(['Utility', 'Replaces', 'Probe'], [
    { cells: ['<code>Bun.JSON5</code>', 'json5', W_VERIFIED + ' parse works'] },
    { cells: ['<code>Bun.JSONL</code> (parse/parseChunk)', 'ndjson', W_VERIFIED + ' parse works'] },
    { cells: ['<code>Bun.JSONC.parse()</code>', 'jsonc-parser', W_VERIFIED + ' comments+trailing commas'] },
    { cells: ['<code>Bun.XML</code>', 'fast-xml-parser, xml2js', W_VERIFIED + ' used in-repo'] },
    { cells: ['<code>Bun.TOML</code> (v1.1)', '@iarna/toml', W_VERIFIED + ' used in-repo'] },
    { cells: ['<code>Bun.Archive</code>', 'tar', W_NOTE + ' present; API surface is write (docs example differs)'] },
    { cells: ['<code>Bun.stringWidth / sliceAnsi / wrapAnsi</code>', 'string-width, slice-ansi, wrap-ansi', W_VERIFIED] },
    { cells: ['<code>URLPattern</code>', 'path-to-regexp', W_VERIFIED + ' used in-repo (hash routes)'] },
    { cells: ['<code>CompressionStream / DecompressionStream</code>', 'node:zlib streams', W_VERIFIED + ' gzip round-trip'] },
    { cells: ['<code>Response.textStream()</code>', 'manual TextDecoder streaming', W_VERIFIED + ' async-iterable'] },
    { cells: ['<code>process.on(memoryPressure)</code>', 'custom OS monitoring', W_VERIFIED + ' used in serve.ts'] },
    { cells: ['<code>ML-DSA / ML-KEM</code> (post-quantum)', 'pqc-js', W_VERIFIED + ' ML-DSA-65 keygen works'] },
    { cells: ['<code>Bun.spawn({ cgroup })</code>', 'cgcreate wrappers', W_NOTE + ' Linux-only, documented'] },
    { cells: ['<code>bun repl</code>', 'repl alternatives', W_NOTE + ' native REPL'] },
    { cells: ['<code>bun ./README.md</code>', 'glow, mdless', W_VERIFIED + ' Markdown to ANSI terminal'] },
    { cells: ['<code>Bun.Image</code>', 'sharp, jimp, gm', W_VERIFIED + ' covered at /bun/streams + brand pipeline'] },
    { cells: ['<code>Bun.WebView</code>', 'puppeteer, playwright', W_VERIFIED + ' brand card raster, snapshots'] },
    { cells: ['<code>Bun.SQL</code>', 'pg, mysql2, better-sqlite3', W_VERIFIED + ' used in-repo (event store)'] },
  ]);
  return renderWidgetPage({
    title: 'Built-in Utilities',
    subtitle: 'Everything from JSON5 to post-quantum crypto — baked in, zero npm install',
    badges: ['v1.4.0', '15+ utilities', '0 bytes installed'],
    links: ['/bun/overview', '/bun/networking', '/bun/observability'],
    sections: [
      { heading: 'The toolbox (probed)', html: rows },
      { heading: 'Folded into this repo', html: '<ul><li>Bun.JSON5.parse — massey.config.json5 (src/institutions/massey/config.ts)</li><li>Bun.TOML.parse/stringify — partner registry (partner:toml)</li><li>Bun.Archive — bun:backup native tar</li><li>CompressionStream — zstd-compressed audit evidence</li><li>fetch compress — fetchWithRetry option (resilient-fetch, unsigned bodies only)</li><li>Response.textStream — streamNdjsonLines helper</li><li>process.on(memoryPressure) — serve.ts listener</li><li>Bun.Image / WebView / markdown / XML / SQL / stringWidth — brand pipeline, pages, docs, event store, terminal tools</li></ul>' },
      { heading: 'Replacement math', html: '<p class="muted">The widget claims ~382 MB of npm packages eliminated across 60+ packages — the per-utility npm sizes are estimates; what is certain is that each row above has a working built-in in this repo.</p>' },
    ],
    footer: 'Probes: docs/AGENT-PITFALLS.md §17.',
  });
}
