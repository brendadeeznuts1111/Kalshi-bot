/**
 * performance-page.ts — /bun/performance: Performance Gains widget.
 * The marketing numbers are explicitly NOT claimed; what is real and
 * verified here is the repo's own profiler usage and measured artifacts.
 */
import { renderWidgetPage, widgetTable, W_MARKETING } from '../lib/widget-page.ts';

export function renderPerformancePage(): string {
  const cpu = widgetTable(['Metric', 'Bun 1.3', 'Bun 1.4 (claim)', 'Status'], [
    { cells: ['p99 CPU (Claude Code)', '24%', '10%', W_MARKETING] },
    { cells: ['p50 CPU', '5.8%', '2.5%', W_MARKETING] },
    { cells: ['hello-world idle CPU', '5x', 'baseline', W_MARKETING] },
  ]);
  const mem = widgetTable(['Server', 'Bun 1.4 (claim)', 'Bun 1.3', 'Status'], [
    { cells: ['Bun.serve', '36 MB', '45 MB', W_MARKETING] },
    { cells: ['node:http', '81 MB', '135 MB', W_MARKETING] },
    { cells: ['fastify', '120 MB', '233 MB', W_MARKETING] },
    { cells: ['Next.js SSR (4,000 pages)', '238 MB settled', 'grows unbounded', W_MARKETING] },
  ]);
  const ffi = widgetTable(['Operation', 'Bun 1.3', 'Bun 1.4 (claim)', 'Status'], [
    { cells: ['no-op call', '2.13 ns', '0.70 ns (3.0x)', W_MARKETING] },
    { cells: ['new CString(ptr)', '92.5 ns', '24.1 ns (3.8x)', W_MARKETING] },
    { cells: ['OpenTUI layout (1,000 reads)', '—', '2.08x', W_MARKETING] },
  ]);
  const startup = widgetTable(['Platform', 'Bun 1.4 (claim)', 'Node 26 (claim)', 'Status'], [
    { cells: ['Linux startup', '5.1 ms', '27.2 ms', W_MARKETING] },
    { cells: ['Linux peak memory', '14.6 MB', '44.5 MB', W_MARKETING] },
    { cells: ['Binary size (Linux x64)', '77.0 MB', '88.5 MB (-13%)', W_MARKETING] },
  ]);
  return renderWidgetPage({
    title: 'Performance Gains',
    subtitle: 'The claimed CPU/memory/startup wins — presented as marketing figures, NOT independently verified in this repo',
    badges: ['v1.4.0', 'Rust', 'SIMD', 'io_uring'],
    links: ['/bun/networking', '/bun/streams', '/bun/observability'],
    sections: [
      { heading: 'CPU claims', html: cpu + '<p class="muted">These are Bun release-note figures. What THIS repo measures instead: profile:serve / profile:research:full / profile:design write real CPU profiles of our own workloads.</p>' },
      { heading: 'Memory claims', html: mem },
      { heading: 'Startup and binary claims', html: startup },
      { heading: 'bun:ffi (JIT) + HTTP/3', html: ffi + '<p class="muted">FFI speedups are release-note figures; what is verified: <code>bun:ffi</code> dlopen is present and functional in 1.4.0. HTTP/3 static-route throughput (2.7x) is likewise a claim — HTTP/3 itself requires tls (probed).</p>' },
      { heading: 'What is real here', html: '<ul><li>Our own CPU/heap profiles (CPU.*.md, Heap.*.md artifacts)</li><li>Bundle sizes from metafiles: design-system 6.32 KB, hq-app 48.70 KB (bounded by design:check budgets)</li><li>Zero-copy sendfile serving + Range/206 verified in-repo</li></ul>' },
    ],
    footer: 'Numbers without methodology are marketing. The repo own profiles are the proof that matters here.',
  });
}
