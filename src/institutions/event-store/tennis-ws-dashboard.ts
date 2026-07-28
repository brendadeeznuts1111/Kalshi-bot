// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/runtime/webview
/**
 * Self-contained HTML dashboard for tennis WS / book_ticks ground (WebView target).
 */
import type { Database } from "bun:sqlite";
import type { BookSnapshot } from "../alpha-signal-types.ts";
import { midFromBookSnapshot } from "../../bot/kalshi-book-parse.ts";
import {
  sqlBrand,
  type KalshiEventTicker,
  type KalshiMarketTicker,
  unbrand,
} from "./brands.ts";
import { eventTickerFromMarketTicker, listWatchEvents } from "./live-scores.ts";
import { analyzeTennisBookCoverage, type TennisBookCoverageReport } from "./tennis-book-coverage.ts";
import {
  KALSHI_BOOK_SOURCE_REST,
  KALSHI_BOOK_SOURCE_WS,
  resolveTennisLeadMinutes,
  resolveTennisWatchLimit,
  TENNIS_DASHBOARD_MAX_ROWS,
} from "./tennis-lane-constants.ts";
import { listRecordTickers } from "./watch-set.ts";

export type WsBookRow = {
  ticker: KalshiMarketTicker;
  eventTicker: KalshiEventTicker;
  label: string;
  midCents: number | null;
  tickCount: number;
  wsTicks: number;
  restTicks: number;
  lastSeq: number | null;
  lastTs: number;
  source: string;
  sourceClock: string;
};

export type TennisWsDashboardModel = {
  at: string;
  watchEvents: number;
  watchTickers: number;
  wsTicks: number;
  restTicks: number;
  coverage: TennisBookCoverageReport;
  rows: WsBookRow[];
};

function parseBook(json: string): BookSnapshot | null {
  try {
    return JSON.parse(json) as BookSnapshot;
  } catch {
    return null;
  }
}

export function loadTennisWsDashboardModel(
  db: Database,
  options: { leadMinutes?: number; limit?: number } = {},
): TennisWsDashboardModel {
  const leadMinutes = resolveTennisLeadMinutes(options.leadMinutes);
  const limit = resolveTennisWatchLimit(options.limit);
  const watch = listRecordTickers(db, { leadMinutes, limit });
  const events = listWatchEvents(db, { leadMinutes, limit, clearStale: false });

  const coverage = analyzeTennisBookCoverage(db, { leadMinutes, limit });
  const wsTicks = coverage.wsTicksTotal;
  const restTicks = coverage.restTicksTotal;

  const latestByTicker = loadLatestBookTicksForWatch(db, watch.tickers);

  const watchSet = new Set(watch.tickers);
  const rows: WsBookRow[] = [];
  for (const raw of latestByTicker) {
    const ticker = sqlBrand.marketTicker(raw.ticker);
    if (watchSet.size > 0 && !watchSet.has(ticker)) continue;
    const book = parseBook(raw.levels_json);
    const mid = book ? midFromBookSnapshot(book) : null;
    const eventTicker = eventTickerFromMarketTicker(ticker);
    if (!eventTicker) continue;
    const countRow = db
      .query(
        `SELECT COUNT(*) AS n,
                SUM(CASE WHEN source = $ws THEN 1 ELSE 0 END) AS ws_n,
                SUM(CASE WHEN source = $rest THEN 1 ELSE 0 END) AS rest_n
         FROM book_ticks WHERE ticker = $t`,
      )
      .get({
        $t: unbrand(ticker),
        $ws: KALSHI_BOOK_SOURCE_WS,
        $rest: KALSHI_BOOK_SOURCE_REST,
      }) as { n: number; ws_n: number; rest_n: number };
    rows.push({
      ticker,
      eventTicker,
      label: raw.label ?? unbrand(eventTicker),
      midCents: mid,
      tickCount: countRow.n,
      wsTicks: countRow.ws_n,
      restTicks: countRow.rest_n,
      lastSeq: raw.seq,
      lastTs: raw.ts,
      source: raw.source,
      sourceClock: raw.source_clock,
    });
  }

  rows.sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0));

  return {
    at: new Date().toISOString(),
    watchEvents: events.length,
    watchTickers: watch.tickers.length,
    wsTicks,
    restTicks,
    coverage,
    rows: rows.slice(0, TENNIS_DASHBOARD_MAX_ROWS),
  };
}

type LatestWatchBookRow = {
  ticker: string;
  ts: number;
  recv_ts: number;
  source: string;
  source_clock: string;
  seq: number | null;
  levels_json: string;
  label: string | null;
};

/** Latest book_tick per watch ticker only (no global LIMIT 48 drift). */
function loadLatestBookTicksForWatch(
  db: Database,
  tickers: readonly KalshiMarketTicker[],
): LatestWatchBookRow[] {
  if (tickers.length === 0) return [];
  const placeholders = tickers.map((_, i) => `$t${i}`).join(", ");
  const params: Record<string, string> = {};
  for (let i = 0; i < tickers.length; i++) {
    params[`$t${i}`] = unbrand(tickers[i]!);
  }
  return db
    .query(
      `SELECT bt.ticker, bt.ts, bt.recv_ts, bt.source, bt.source_clock, bt.seq, bt.levels_json,
              m.yes_side_label AS label
       FROM book_ticks bt
       LEFT JOIN markets m ON m.ticker = bt.ticker
       WHERE bt.id IN (
         SELECT MAX(id) FROM book_ticks WHERE ticker IN (${placeholders}) GROUP BY ticker
       )
       ORDER BY bt.ts DESC`,
    )
    .all(params) as LatestWatchBookRow[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline HTML for Bun.WebView `data:` navigation. */
export function renderTennisWsDashboardHtml(model: TennisWsDashboardModel): string {
  const rowsHtml = model.rows
    .map((r) => {
      const mid = r.midCents == null ? "—" : `${r.midCents}¢`;
      const age = r.lastTs ? `${Math.round((Date.now() - r.lastTs) / 1000)}s ago` : "—";
      const seq = r.lastSeq == null ? "—" : String(r.lastSeq);
      const ageSec = r.lastTs ? Math.round((Date.now() - r.lastTs) / 1000) : Infinity;
      const isLive = ageSec < 60;
      const wsClass = r.wsTicks > 0 ? "ws-ok" : r.restTicks > 0 ? "ws-miss" : "ws-empty";
      const liveClass = isLive ? "live" : "";
      const badge = isLive
        ? '<span class="badge badge-live">LIVE</span>'
        : '<span class="badge badge-stale">stale</span>';
      return `<tr class="${liveClass} ${wsClass}">
        <td>${esc(r.label.slice(0, 28))}${badge}</td>
        <td>${esc(r.eventTicker.slice(0, 32))}</td>
        <td class="num">${mid}</td>
        <td class="num">${r.wsTicks}/${r.restTicks}</td>
        <td class="num">${seq}</td>
        <td>${esc(r.source)}</td>
        <td>${esc(r.sourceClock)}</td>
        <td class="muted">${age}</td>
      </tr>`;
    })
    .join("");

  const c = model.coverage;
  const exchPct = c.wsExchangeClockPct == null ? "—" : `${c.wsExchangeClockPct}%`;
  const wsPct = c.watchTickers > 0 ? Math.round((c.watchWithWs / c.watchTickers) * 100) : 0;
  const restPct = c.watchTickers > 0 ? Math.round((c.watchWithRest / c.watchTickers) * 100) : 0;
  const nonePct = 100 - wsPct - restPct;

  const meterHtml = c.watchTickers > 0
    ? `<div class="meta">
        <span class="pill">watch-set coverage</span>
        <span class="meter-wrap" title="WS ${wsPct}% | REST-only ${restPct}% | None ${nonePct}%">
          <div class="meter-fill meter-ws" style="width:${wsPct}%;display:inline-block;"></div>
          <div class="meter-fill meter-rest" style="width:${restPct}%;display:inline-block;"></div>
          <div class="meter-fill meter-none" style="width:${nonePct}%;display:inline-block;"></div>
        </span>
        <span style="color:#3fb950;margin-left:8px;">${wsPct}% WS</span>
        <span style="color:#d29922;margin-left:8px;">${restPct}% REST-only</span>
        <span style="color:#f85149;margin-left:8px;">${nonePct}% none</span>
       </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta http-equiv="refresh" content="30"/>
  <title>Tennis WS ground</title>
  <style>
    :root { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #0d1117; color: #e6edf3; }
    body { margin: 24px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
    .meta { color: #8b949e; font-size: 12px; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #21262d; }
    th { color: #8b949e; font-weight: 500; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: #6e7681; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #161b22; margin-right: 8px; }
    .meter-wrap { width: 240px; height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-left: 6px; }
    .meter-fill { height: 100%; border-radius: 3px; }
    .meter-ws { background: #3fb950; }
    .meter-rest { background: #d29922; }
    .meter-none { background: #f85149; }
    tr.live { background: rgba(47, 129, 247, 0.08); }
    tr.ws-ok td:first-child { border-left: 3px solid #3fb950; }
    tr.ws-miss td:first-child { border-left: 3px solid #d29922; }
    tr.ws-empty td:first-child { border-left: 3px solid #f85149; }
    .badge { font-size: 10px; padding: 1px 5px; border-radius: 4px; margin-left: 6px; }
    .badge-live { background: #238636; color: #fff; }
    .badge-stale { background: #6e7681; color: #fff; }
  </style>
</head>
<body>
  <h1>Kalshi tennis — watch-set books</h1>
  <div class="meta">${esc(model.at)} · watch ${model.watchEvents} events / ${model.watchTickers} tickers</div>
  ${meterHtml}
  <div class="meta">
    <span class="pill">${esc(KALSHI_BOOK_SOURCE_WS)} ticks: ${model.wsTicks}</span>
    <span class="pill">${esc(KALSHI_BOOK_SOURCE_REST)} ticks: ${model.restTicks}</span>
    <span class="pill">watch WS: ${c.watchWithWs}/${c.watchTickers}</span>
    <span class="pill">exchange clock: ${exchPct}</span>
    <span class="pill">linked+ws: ${c.linkedEventsWithWs}/${c.linkedEventsTotal}</span>
  </div>
  <table>
    <thead><tr>
      <th>Side</th><th>Event</th><th>Mid</th><th>WS/REST</th><th>Seq</th><th>Source</th><th>Clock</th><th>Age</th>
    </tr></thead>
    <tbody>${rowsHtml || "<tr><td colspan=\"8\" class=\"muted\">No book_ticks for watch-set yet — run tennis:record --ws</td></tr>"}</tbody>
  </table>
</body>
</html>`;
}
