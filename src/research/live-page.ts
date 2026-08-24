/**
 * live-page.ts — /bun/live: the Live Channel widget (WebSocket theme + feed).
 * Token-built audited surface; every claim carries a probe status.
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED, W_NOTE, W_MARKETING } from '../lib/widget-page.ts';

export function renderLivePage(): string {
  const flow = widgetTable(['Layer', 'Capability', 'Probe'], [
    { cells: ['<code>Bun.serve</code> websocket', '<code>server.upgrade(req)</code> + <code>websocket {open,message,close}</code>', W_VERIFIED + ' two-way echo, readyState === OPEN (1), ws.data passthrough'] },
    { cells: ['Broadcast', '<code>ws.subscribe(topic)</code> / <code>server.publish(topic, msg)</code>', W_VERIFIED + ' subscriber received the published message (probe)'] },
    { cells: ['Feed store', '<code>bun:sqlite</code> <code>INSERT OR IGNORE</code> dedup by link', W_VERIFIED + ' second insert of same link ignored (changes === 0)'] },
    { cells: ['Feed parse', '<code>Bun.XML.parse</code> RSS/Atom + enclosure <code>@url</code>', W_VERIFIED + ' enclosure / media:content / media:thumbnail shapes'] },
    { cells: ['Theme push', '<code>theme-update</code> cssVars + ANSI payloads', W_VERIFIED + ' live /bun/color explorer consumes them'] },
    { cells: ['Cron refresh', '<code>Bun.cron("0 * * * *")</code> hourly feed poll', W_VERIFIED + ' parse() -> next run Date; unref + once-per-process guard'] },
    { cells: ['Theme change', '<code>change-theme</code> hex validation + broadcast', W_CORRECTED + ' EPHEMERAL (in-memory) — TOKENS stays the audited source; not persisted'] },
  ]);
  const correct = widgetTable(['Doc claim', 'Reality (probe)'], [
    { cells: ['SQLite via <code>Bun.SQL</code>', W_CORRECTED + ' Bun.sql is a POSTGRES tagged-template client (PostgresError). SQLite here is bun:sqlite Database'] },
    { cells: ['<code>Bun.markdown.ansi(md, {heading, strong, …})</code> theme callbacks', W_CORRECTED + ' options ignored in 1.4.0 — terminal theming injects ANSI manually (theme.ts)'] },
    { cells: ['<code>Bun.Image</code> tint/recolor images to match theme', W_CORRECTED + ' modulate() mutates the source Image; hue/lightness no-op, saturation/brightness verified'] },
    { cells: ['Publish <code>theme.json</code> to disk on change', W_CORRECTED + ' not persisted — live overrides are session-scoped broadcasts; disk would break the one-vocabulary audit'] },
    { cells: ['WebSocket broadcast primitives', W_VERIFIED + ' publish/subscribe + upgrade + data + readyState all real'] },
    { cells: ['~100 ns color parse', W_MARKETING + ' measured ~360-550 ns/op (see §22)'] },
  ]);
  const client = [
    '<li><code>new WebSocket((location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/api/live")</code></li>',
    '<li>on open: server pushes <code>theme-update</code> (cssVars + ANSI) and <code>feed-update</code> (recent items)</li>',
    '<li>send <code>{"type":"change-theme","colors":{"primary":"#…"}}</code> — validated, broadcast to all subscribers</li>',
    '<li>re-render: apply cssVars to <code>:root</code>; swap feed rows on <code>feed-update</code></li>',
  ];
  return renderWidgetPage({
    title: 'Live Channel',
    subtitle: 'WebSocket theme + feed broadcast on the research server — zero deps (Bun.serve websocket + bun:sqlite + Bun.XML + Bun.cron)',
    badges: ['WebSocket', 'pub/sub', 'feed dedup', 'live theme'],
    links: ['/bun/overview', '/bun/color', '/api/live', '/api/color/theme'],
    sections: [
      { heading: 'The pipeline (probe-verified)', html: flow },
      { heading: 'Client contract', html: '<ul>' + client.join('') + '</ul><p class="muted">Same theme payload the /bun/color explorer renders statically — the live channel is the push side of the same vocabulary.</p>' },
      { heading: 'Doc corrections', html: correct },
      { heading: 'Folded into this repo', html: '<ul><li>src/institutions/live-channel.ts (FeedStore dedup + theme payload + handlers)</li><li>serve.ts: /api/live upgrade + websocket config + hourly feed cron</li><li>release-blog.ts: imageUrl extraction (enclosure @url)</li></ul>' },
    ],
    footer: 'Probes: docs/AGENT-PITFALLS.md §23 · source: src/institutions/live-channel.ts',
  });
}
