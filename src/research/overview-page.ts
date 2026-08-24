/**
 * overview-page.ts — /bun/overview: the Bun 1.4 Overview / dependency-killer
 * widget. Verified-vs-marketing framing on every stat. Token-built surface.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_MARKETING } from '../lib/widget-page.ts';

export function renderOverviewPage(): string {
  const stats = widgetTable(['Metric', 'Value', 'Status'], [
    { cells: ['Built-in APIs', '15+ (XML, Image, Markdown, SQL, WebView, Cron, TOML, JSON5/JSONL/JSONC, Archive, URLPattern, Terminal, FFI, HTTP/3)', W_VERIFIED + ' present in 1.4.0 — Terminal/FFI/HTTP3 verified as present, not for every claim (see /bun/markdown, /bun/security, §36)'] },
    { cells: ['npm packages replaced', '60+', W_MARKETING + ' estimate'] },
    { cells: ['Dependency size eliminated', '~382 MB', W_MARKETING + ' estimate incl. browser automation'] },
    { cells: ['Node.js compatibility tests', '1,517 passing', W_MARKETING + ' release-note claim'] },
    { cells: ['Rust rewrite', '535k Zig -> 1M+ Rust, 64 agents, 11 days', W_MARKETING + ' release-note claim'] },
    { cells: ['Idle CPU reduction', '5x lower', W_MARKETING] },
    { cells: ['Memory reduction (load)', '13-48% across frameworks', W_MARKETING] },
    { cells: ['Startup (Linux)', '5.1 ms', W_MARKETING] },
    { cells: ['Binary (Linux x64)', '77 MB (-13%)', W_MARKETING] },
  ]);
  const cats = widgetTable(['Category', 'Built-ins'], [
    { cells: ['Parsers', 'XML, TOML, JSON5, JSONL, JSONC'] },
    { cells: ['Images', 'Bun.Image + WebView raster'] },
    { cells: ['Networking', 'HTTP/1.1/2/3, TCP/UDP, TLS, fetch'] },
    { cells: ['Markdown', 'Bun.markdown (html/ansi/render/react)'] },
    { cells: ['Scheduling', 'Bun.cron'] },
    { cells: ['Automation', 'Bun.WebView'] },
    { cells: ['Persistence', 'Bun.SQL'] },
    { cells: ['Dev tooling', 'FFI, PTY, --parallel scripts, profilers'] },
    { cells: ['Terminal unification', 'ANSI utilities, Markdown render, stringWidth'] },
  ]);

  return renderWidgetPage({
    title: 'Overview — the Dependency Killer',
    subtitle: '15+ built-in APIs · the dependency-math story, with verified-vs-marketing framing',
    badges: ['v1.4.0', '15+ APIs', 'Zero deps'],
    links: ['/bun/utilities', '/bun/networking', '/bun/streams', '/bun/observability', '/bun/performance'],
    sections: [
      { heading: 'Key stats', html: stats },
      { heading: 'Categories', html: cats },
      { heading: 'The payoff', html: '<p class="muted">No separate packages for parsing, image processing, database clients, browser automation, cron, Markdown, or profiling. Every widget page in this dashboard probes the claim against the runtime.</p>' },
    ],
    footer: 'Verified claims are marked; marketing figures stay labeled. Probes: docs/AGENT-PITFALLS.md §17.',
  });
}
