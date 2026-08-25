/**
 * observability-page.ts — /bun/observability: Observability & Profiling widget.
 * Every profiler here is USED by this repo (profile:serve, profile:design,
 * design:build metafile-md, serve memoryPressure listener).
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED } from '../lib/widget-page.ts';

export function renderObservabilityPage(): string {
  const profilers = widgetTable(['Profiler', 'Status'], [
    { cells: ['<code>--cpu-prof-md</code> — CPU profile as Markdown', W_VERIFIED + ' used by profile:serve / profile:design / profile:research'] },
    { cells: ['<code>--heap-prof-md</code> — heap report as Markdown', W_VERIFIED + ' used by heap:serve'] },
    { cells: ['<code>--metafile-md</code> — bundle report as Markdown', W_VERIFIED + ' this repo design-system.meta.md + hq-app.meta.md'] },
    { cells: ['<code>BUN_CPU_PROFILE=1</code>', W_VERIFIED + ' enables the CPU profiler for processes you cannot pass flags to (probe §55: .cpuprofile written)'] },
    { cells: ['<code>--heap-prof-md</code>', W_VERIFIED + ' markdown heap report (Summary + Top 50 Types by Retained Size)'] },
    { cells: ['<code>process.on(memoryPressure)</code>', W_VERIFIED + ' serve.ts listener (kqueue / PSI / CreateMemoryResourceNotification)'] },
    { cells: ['<code>Bun.markdown.ansi()</code>', W_VERIFIED + ' renders Markdown to ANSI terminal output'] },
  ]);
  const cpu = '<pre># CPU Profile — Duration 304.9ms · 279 samples · 1.0ms interval' +
    '\n| Self% | Function | Location |' +
    '\n| 39.1% | tokenize | app.ts:14 |' +
    '\n| 25.6% | escapeHtml | app.ts:5 |</pre>' +
    '<p class="muted">SSH-friendly (profile a remote server, read locally), LLM-ready (paste the Markdown), greppable.</p>';
  const quick = '<pre># bun run profile:all — every profiler, Markdown out' +
    'bun --cpu-prof-md src/research/serve.ts' +
    'bun --heap-prof-md scripts/build-design-system.ts' +
    'bun run design:build  # -> dist/design-system.meta.md' +
    'bun ./docs/COLORS.md  # render Markdown to the terminal</pre>';
  return renderWidgetPage({
    title: 'Observability & Profiling',
    subtitle: 'Built-in CPU / heap / bundle profilers that stream Markdown to the terminal — plus OS-level memory-pressure events',
    badges: ['v1.4.0', 'Markdown', 'Terminal-first', 'Zero deps'],
    links: ['/bun/networking', '/bun/streams', '/bun/performance'],
    sections: [
      { heading: 'Terminal-first profiling', html: '<p class="muted">No Chrome DevTools needed — the profilers write Markdown you can read, grep, pipe to an LLM, or render natively. Every report is a design document.</p>' },
      { heading: 'The profilers (all used in this repo)', html: profilers },
      { heading: 'Sample CPU report', html: cpu },
      { heading: 'Quick start', html: quick + '<p class="muted">Run them all with <code>bun run profile:all</code>.</p>' },
    ],
    footer: 'Observe every pipeline — never leave the CLI. Probes: docs/AGENT-PITFALLS.md §16.',
  });
}
