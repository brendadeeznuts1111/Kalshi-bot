/**
 * trend-page.ts — /design/trend visual bundle history (no client-side libs:
 * a styled table + pure-CSS sparkline bars from dist/bundle-history.json).
 *
 * The page is an ENFORCED design surface: all chrome uses token vars from
 * /design-system.css; the only literals are data (timestamps, sizes, %).
 */
import { BRAND } from '../institutions/design-tokens.ts';
import { DESIGN_MODULES, DESIGN_MODULE_NAMES, type BundleHistory } from '../lib/design-budget.ts';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>\"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(2) + ' KB';
}

function deltaBadge(prev: number | null | undefined, cur: number): string {
  if (prev === null || prev === undefined || prev === 0) return '<span class="muted">—</span>';
  const pct = ((cur - prev) / prev) * 100;
  const cls = pct > 25 ? 'bad' : pct > 10 ? 'warn' : pct < -5 ? 'ok' : 'dim';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '•';
  return '<span class="delta ' + cls + '">' + arrow + ' ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span>';
}

/**
 * Sparkline row: one bar per build, height proportional to size within the
 * module's range (pure CSS — token colors only).
 */
function sparkline(entries: Array<{ bytes: number }>): string {
  if (!entries.length) return '<span class="muted">no history</span>';
  const max = Math.max(...entries.map((e) => e.bytes), 1);
  const bars = entries
    .map((e) => {
      const h = Math.max(4, Math.round((e.bytes / max) * 100));
      return '<span class="bar" style="height:' + h + '%" title="' + kb(e.bytes) + '"></span>';
    })
    .join('');
  return '<span class="spark">' + bars + '</span>';
}

export function renderTrendPage(history: BundleHistory, generatedAt: string): string {
  const len = Math.max(...DESIGN_MODULE_NAMES.map((m) => history[m]?.length ?? 0));

  const rows: string[] = [];
  for (let i = 0; i < len; i += 1) {
    const tsEntry = DESIGN_MODULE_NAMES.map((m) => history[m]?.[i]).find((e) => e?.at) ?? null;
    const ts = tsEntry ? new Date(tsEntry.at).toLocaleString() : '—';
    const commitCell = tsEntry?.commit
      ? '<td class="mono muted">' + esc(tsEntry.commit) +
        (tsEntry.message ? ' <span class="commit-msg">' + esc(String(tsEntry.message).slice(0, 48)) + '</span>' : '') +
        '</td>'
      : '<td class="muted">—</td>';
    const cells = DESIGN_MODULE_NAMES.map((m) => {
      const entries = history[m] ?? [];
      const cur = entries[i];
      const prev = entries[i - 1];
      return cur
        ? '<td class="mono">' + kb(cur.bytes) + '</td><td>' + deltaBadge(prev?.bytes, cur.bytes) + '</td>'
        : '<td class="muted">—</td><td class="muted">—</td>';
    }).join('');
    rows.push('<tr><td class="mono muted">' + esc(ts) + '</td>' + commitCell + cells + '</tr>');
  }
  const body = len ? rows.join('') : '<tr><td colspan="7" class="muted">No history yet — run <code>bun run design:build</code> at least twice to seed the trend.</td></tr>';

  const sparks = DESIGN_MODULE_NAMES.map((m) =>
    '<tr><th>' + esc(m) + '</th><td>' + sparkline(history[m] ?? []) + '</td></tr>',
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${BRAND.name} — bundle trend</title>
<link rel="stylesheet" href="/design-system.css" />
<style>
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, \"SF Pro Text\", Segoe UI, sans-serif; padding: 2rem 2.5rem 4rem; }
header { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }
header h1 { margin: 0; font-size: 1.2rem; letter-spacing: 0.04em; }
header h1 span { color: var(--acc); }
header p { color: var(--dim); font-size: 0.8rem; margin: 0.3rem 0 0; }
section { margin-bottom: 1.75rem; }
h2 { font-size: 0.95rem; margin: 0 0 0.6rem; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
th, td { text-align: left; padding: 0.35rem 0.6rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { color: var(--dim); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
td.mono { font-family: var(--mono); }
.delta.ok { color: var(--ok); } .delta.warn { color: var(--warn); } .delta.bad { color: var(--bad); } .delta.dim { color: var(--dim); }
.spark { display: inline-flex; align-items: flex-end; gap: 2px; height: 2.2rem; }
.bar { display: inline-block; width: 5px; border-radius: 4px; background: var(--acc); opacity: 0.85; }
a { color: var(--acc); }
footer { color: var(--dim); font-size: 0.75rem; margin-top: 2rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }
</style>
</head>
<body>
<header><h1>${BRAND.name} <span>bundle trend</span></h1><p>generated ${esc(generatedAt)} · budgets at <a href="/api/design/budgets">/api/design/budgets</a> · inspector at <a href="/design">/design</a></p></header>
<section><h2>Sparklines</h2><table><tr><th>Module</th><th>Last ${esc(String(len))} build(s)</th></tr>${sparks}</table></section>
<section><h2>History</h2><table><tr><th>Build</th><th>Commit</th>${DESIGN_MODULE_NAMES.map((m) => '<th>' + esc(m) + '</th><th>Δ</th>').join('')}</tr>${body}</table></section>
<footer>Per-module budgets: ${DESIGN_MODULE_NAMES.map((m) => esc(m) + ' ≤ ' + (DESIGN_MODULES[m].maxBytes / 1024) + ' KB').join(' · ')} — the +25% growth gate is enforced by design:check.</footer>
</body>
</html>
`;
}
