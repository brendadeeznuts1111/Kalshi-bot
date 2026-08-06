// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/webview
/**
 * Self-contained HTML dashboard for match_liquidity (Bun.WebView target).
 * Offline — reads event-store only; no network.
 */
import type { Database } from "bun:sqlite";
import {
  LIQUIDITY_GATES,
  listTopMatchLiquidity,
  summarizeMatchLiquidity,
  type MatchLiquidityRow,
  type MatchLiquiditySummary,
} from "./match-liquidity.ts";

export const MATCH_LIQUIDITY_DASHBOARD_MAX_ROWS = 48;

export type MatchLiquidityDashboardModel = {
  at: string;
  summary: MatchLiquiditySummary;
  gates: typeof LIQUIDITY_GATES;
  rows: MatchLiquidityRow[];
};

export function loadMatchLiquidityDashboardModel(
  db: Database,
  options: { limit?: number } = {},
): MatchLiquidityDashboardModel {
  const limit = options.limit ?? MATCH_LIQUIDITY_DASHBOARD_MAX_ROWS;
  const summary = summarizeMatchLiquidity(db);
  // Prefer quoted / ok first; fall back to top by volume so board is never empty when table has data.
  let rows = listTopMatchLiquidity(db, { limit, onlyQuoted: true });
  if (rows.length < Math.min(8, limit)) {
    const rest = listTopMatchLiquidity(db, { limit });
    const seen = new Set(rows.map((r) => r.eventId));
    for (const r of rest) {
      if (seen.has(r.eventId)) continue;
      rows.push(r);
      if (rows.length >= limit) break;
    }
  }
  return {
    at: new Date().toISOString(),
    summary,
    gates: LIQUIDITY_GATES,
    rows: rows.slice(0, limit),
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtVol(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Inline HTML for Bun.WebView `data:` navigation. */
export function renderMatchLiquidityDashboardHtml(model: MatchLiquidityDashboardModel): string {
  const s = model.summary;
  const g = model.gates;
  const rowsHtml = model.rows
    .map((r) => {
      const gateVol = r.volume24hFp > 0 ? r.volume24hFp : r.volumeFp;
      const mid = r.midCents == null ? "—" : `${r.midCents}¢`;
      const sp = r.spreadCents == null ? "—" : `${r.spreadCents}¢`;
      const rowClass = r.tradable ? "tradable" : r.liquidityOk ? "liq-ok" : r.bookTickCount > 0 ? "quoted" : "thin";
      const badge = r.tradable
        ? '<span class="badge badge-tradable">tradable</span>'
        : r.liquidityOk
          ? '<span class="badge badge-ok">liq_ok</span>'
          : r.bookTickCount > 0
            ? '<span class="badge badge-quoted">quoted</span>'
            : '<span class="badge badge-thin">thin</span>';
      return `<tr class="${rowClass}">
        <td>${esc(r.tournament.slice(0, 28))}${badge}</td>
        <td class="muted">${esc(r.tour)}</td>
        <td class="num">${fmtVol(gateVol)}</td>
        <td class="num">${fmtVol(r.volume24hFp)}</td>
        <td class="num">${sp}</td>
        <td class="num">${mid}</td>
        <td class="num">${r.bookTickCount}</td>
        <td class="mono muted">${esc(r.eventId.slice(0, 10))}</td>
      </tr>`;
    })
    .join("");

  const quotedPct = s.total > 0 ? Math.round((s.quoted / s.total) * 100) : 0;
  const okPct = s.total > 0 ? Math.round((s.liquidityOk / s.total) * 100) : 0;
  const trPct = s.total > 0 ? Math.round((s.tradable / s.total) * 100) : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="refresh" content="60"/>
  <title>Match liquidity ground</title>
  <style>
    :root { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #0d1117; color: #e6edf3; }
    body { margin: 24px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
    .meta { color: #8b949e; font-size: 12px; margin-bottom: 12px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 500; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: #6e7681; }
    .mono { font-family: inherit; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #161b22; margin-right: 8px; }
    .meter-wrap { width: 280px; height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; display: inline-block; vertical-align: middle; margin-left: 8px; }
    .meter-fill { height: 100%; display: inline-block; }
    .meter-tr { background: #3fb950; }
    .meter-ok { background: #58a6ff; }
    .meter-q { background: #d29922; }
    tr.tradable { background: rgba(63, 185, 80, 0.08); }
    tr.liq-ok { background: rgba(88, 166, 255, 0.06); }
    tr.quoted td:first-child { border-left: 3px solid #d29922; }
    tr.tradable td:first-child { border-left: 3px solid #3fb950; }
    tr.liq-ok td:first-child { border-left: 3px solid #58a6ff; }
    tr.thin td:first-child { border-left: 3px solid #484f58; }
    .badge { font-size: 10px; padding: 1px 5px; border-radius: 4px; margin-left: 6px; }
    .badge-tradable { background: #238636; color: #fff; }
    .badge-ok { background: #1f6feb; color: #fff; }
    .badge-quoted { background: #9e6a03; color: #fff; }
    .badge-thin { background: #6e7681; color: #fff; }
  </style>
</head>
<body>
  <h1>Match liquidity — desk ground</h1>
  <div class="meta">${esc(model.at)} · gates vol≥${g.minVolume24hFp} (24h|lifetime) · spread≤${g.maxSpreadCents}¢ · mid ${g.midBandMinCents}–${g.midBandMaxCents}¢</div>
  <div class="meta">
    <span class="pill">rows ${s.total}</span>
    <span class="pill">quoted ${s.quoted}</span>
    <span class="pill">liq_ok ${s.liquidityOk}</span>
    <span class="pill">tradable ${s.tradable}</span>
    <span class="pill">lifetime-only≥500 ${s.lifetimeOnly500}</span>
    <span class="meter-wrap" title="tradable ${trPct}% | liq_ok ${okPct}% | quoted ${quotedPct}%">
      <div class="meter-fill meter-tr" style="width:${trPct}%;"></div>
      <div class="meter-fill meter-ok" style="width:${Math.max(0, okPct - trPct)}%;"></div>
      <div class="meter-fill meter-q" style="width:${Math.max(0, quotedPct - okPct)}%;"></div>
    </span>
  </div>
  <table>
    <thead><tr>
      <th>Tournament</th><th>Tour</th><th>Gate vol</th><th>Vol24h</th><th>Spread</th><th>Mid</th><th>Quotes</th><th>Event</th>
    </tr></thead>
    <tbody>${rowsHtml || `<tr><td colspan="8" class="muted">${s.tablePresent ? "No match_liquidity rows — run liquidity:recompute" : "match_liquidity table missing — openEventStore / PR1 schema"}</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}
