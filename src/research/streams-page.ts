/**
 * streams-page.ts — /bun/streams: Streams & Backpressure widget, token-built.
 * Claims probed against Bun 1.4.0; benchmarks marked as marketing.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_MARKETING, W_NOTE } from '../lib/widget-page.ts';

export function renderStreamsPage(): string {
  const primitives = widgetTable(['Primitive', 'Probe'], [
    { cells: ['<code>Bun.stringWidth()</code> — grapheme-aware width', W_VERIFIED + ' emoji 3, CJK 4, ANSI-invariant'] },
    { cells: ['<code>Bun.sliceAnsi() / Bun.wrapAnsi()</code>', W_VERIFIED + ' slice preserves ANSI codes'] },
    { cells: ['<code>CompressionStream / DecompressionStream</code>', W_VERIFIED + ' gzip round-trip (6000 -> 74 -> 6000 B)'] },
    { cells: ['<code>TextEncoderStream / TextDecoderStream</code>', W_VERIFIED] },
    { cells: ['<code>Response.clone()</code>', W_VERIFIED + ' both bodies read independently'] },
    { cells: ['fetch compress option', W_NOTE + ' gzip/deflate/br/zstd request bodies'] },
  ]);
  const bench = widgetTable(['Pipeline', 'Bun 1.4 (claim)', 'Status'], [
    { cells: ['Download fetch -> DecompressionStream -> TextDecoder', '1,519 MB/s', W_MARKETING] },
    { cells: ['Upload fs -> CompressionStream -> POST', '179 MB/s', W_MARKETING] },
    { cells: ['Transcode decode -> encode -> fs', '132 MB/s', W_MARKETING] },
    { cells: ['Subprocess fetch -> cat -> for-await', '751 MB/s', W_MARKETING] },
  ]);
  return renderWidgetPage({
    title: 'Streams & Backpressure',
    subtitle: 'Native ReadableStream / WritableStream / TransformStream — backpressure-aware, terminal-observable flow control',
    badges: ['v1.4.0', 'Web streams', 'Backpressure', 'Zero-copy'],
    links: ['/bun/networking', '/bun/observability', '/bun/performance'],
    sections: [
      { heading: 'Pipeline philosophy', html: '<p class="muted">Every I/O path is a stream; every stream is watchable from the terminal. Bun.stringWidth keeps progress bars grapheme-correct; backpressure (pull() pausing when the socket buffer fills) is the OOM fix.</p>' },
      { heading: 'Primitives (probed)', html: primitives },
      { heading: 'Throughput claims', html: bench + '<p class="muted">Marketing figures (up to 7.4x vs Node) are not independently measured here — the primitives themselves are verified and used in-repo.</p>' },
      { heading: 'Backpressure', html: '<pre>new Response(new ReadableStream({ pull(c) { c.enqueue(bytes); /* pauses when the socket buffer fills */ } }))</pre><p class="muted">Native streams apply backpressure automatically — a slow client can no longer OOM the server by buffering unsent chunks.</p>' },
    ],
    footer: 'Streams are the how — the terminal is the where. Probes: docs/AGENT-PITFALLS.md §16.',
  });
}
