// @see https://bun.com/docs/runtime/sqlite
/**
 * Tennis book_ticks coverage — watch-set vs WS vs REST vs dual-clock.
 */
import type { Database } from "bun:sqlite";
import { sqlBrand, unbrand, type KalshiMarketTicker } from "./brands.ts";
import { listRecordTickers } from "./watch-set.ts";

export type TennisBookCoverageReport = {
  watchEvents: number;
  watchTickers: number;
  /** Tickers in watch-set with ≥1 kalshi-ws row. */
  watchWithWs: number;
  /** Tickers in watch-set with ≥1 kalshi-rest row. */
  watchWithRest: number;
  watchWithBoth: number;
  watchWithNeither: number;
  /** Global book_ticks counts by source. */
  wsTicksTotal: number;
  restTicksTotal: number;
  /** Among kalshi-ws rows: share with source_clock=exchange (delta ts_ms). */
  wsExchangeClockTicks: number;
  wsExchangeClockPct: number | null;
  /** Linked bridge events that have any kalshi-ws tick. */
  linkedEventsWithWs: number;
  linkedEventsTotal: number;
};

export function analyzeTennisBookCoverage(
  db: Database,
  options: { leadMinutes?: number; limit?: number; nowMs?: number } = {},
): TennisBookCoverageReport {
  const leadMinutes = options.leadMinutes ?? 5;
  const limit = options.limit ?? 40;
  const watch = listRecordTickers(db, {
    leadMinutes,
    limit,
    clearStale: false,
    nowMs: options.nowMs,
  });

  const bySource = db
    .query(`SELECT source, source_clock, COUNT(*) AS n FROM book_ticks GROUP BY source, source_clock`)
    .all() as Array<{ source: string; source_clock: string; n: number }>;

  let wsTicksTotal = 0;
  let restTicksTotal = 0;
  let wsExchangeClockTicks = 0;
  for (const row of bySource) {
    if (row.source === "kalshi-ws") {
      wsTicksTotal += row.n;
      if (row.source_clock === "exchange") wsExchangeClockTicks += row.n;
    }
    if (row.source === "kalshi-rest") restTicksTotal += row.n;
  }

  let watchWithWs = 0;
  let watchWithRest = 0;
  let watchWithBoth = 0;
  let watchWithNeither = 0;

  if (watch.tickers.length > 0) {
    const placeholders = watch.tickers.map((_, i) => `$t${i}`).join(", ");
    const params: Record<string, string> = {};
    for (let i = 0; i < watch.tickers.length; i++) {
      params[`$t${i}`] = unbrand(watch.tickers[i]!);
    }
    const perTicker = db
      .query(
        `SELECT ticker,
                SUM(CASE WHEN source = 'kalshi-ws' THEN 1 ELSE 0 END) AS ws_n,
                SUM(CASE WHEN source = 'kalshi-rest' THEN 1 ELSE 0 END) AS rest_n
         FROM book_ticks
         WHERE ticker IN (${placeholders})
         GROUP BY ticker`,
      )
      .all(params) as Array<{ ticker: string; ws_n: number; rest_n: number }>;

    const seen = new Set<KalshiMarketTicker>();
    for (const row of perTicker) {
      const ticker = sqlBrand.marketTicker(row.ticker);
      seen.add(ticker);
      const hasWs = row.ws_n > 0;
      const hasRest = row.rest_n > 0;
      if (hasWs) watchWithWs++;
      if (hasRest) watchWithRest++;
      if (hasWs && hasRest) watchWithBoth++;
      else if (!hasWs && !hasRest) watchWithNeither++;
    }
    watchWithNeither += watch.tickers.filter((t) => !seen.has(t)).length;
  }

  const linkedEventsTotal =
    (db.query(`SELECT COUNT(*) AS n FROM event_links WHERE status = 'linked'`).get() as { n: number })
      .n ?? 0;
  const linkedEventsWithWs =
    (db
      .query(
        `SELECT COUNT(DISTINCT bt.event_id) AS n
         FROM book_ticks bt
         INNER JOIN event_links el ON el.kalshi_event_id = bt.event_id AND el.status = 'linked'
         WHERE bt.source = 'kalshi-ws'`,
      )
      .get() as { n: number }).n ?? 0;

  return {
    watchEvents: watch.events.length,
    watchTickers: watch.tickers.length,
    watchWithWs,
    watchWithRest,
    watchWithBoth,
    watchWithNeither,
    wsTicksTotal,
    restTicksTotal,
    wsExchangeClockTicks,
    wsExchangeClockPct:
      wsTicksTotal > 0 ? Math.round((1000 * wsExchangeClockTicks) / wsTicksTotal) / 10 : null,
    linkedEventsWithWs,
    linkedEventsTotal,
  };
}
