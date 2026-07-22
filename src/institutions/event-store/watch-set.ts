/**
 * Shared watch membership for tennis:live + tennis:record.
 * Watch = (start_ts in [now−grace, now+lead] AND outcome=scheduled) OR is_live.
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import type { CanonicalEventId, KalshiMarketTicker } from "./brands.ts";
import { asCanonicalEventId, sqlBrand, unbrand } from "./brands.ts";
import {
  listWatchEvents,
  listWatchEventsForTickers,
  type WatchEvent,
} from "./live-scores.ts";

export {
  listWatchEvents,
  listWatchEventsForTickers,
  type WatchEvent,
};

export type WatchSetOptions = {
  /** Minutes before occurrence_ts (default 5) — aligned with tennis:live --lead. */
  leadMinutes?: number;
  /** Cap watch-set events (default 40). */
  limit?: number;
  pastGraceHours?: number;
  staleMs?: number;
  nowMs?: number;
  /**
   * When true (default), clear stale is_live flags as part of membership.
   * Pass false for dry-run / read-only ticker resolution.
   */
  clearStale?: boolean;
};

export type RecordTickersResult = {
  events: WatchEvent[];
  eventIds: CanonicalEventId[];
  /** Open market tickers under watch-set event_ids (DB markets rows). */
  tickers: KalshiMarketTicker[];
};

/** Market tickers stored for the given Kalshi event_ids (order stable by ticker). */
export function listMarketTickersForEventIds(
  db: Database,
  eventIds: readonly CanonicalEventId[],
): KalshiMarketTicker[] {
  if (eventIds.length === 0) return [];
  const placeholders = eventIds.map((_, i) => `$e${i}`).join(", ");
  const params: Record<string, string> = {};
  for (let i = 0; i < eventIds.length; i++) {
    params[`$e${i}`] = unbrand(eventIds[i]!);
  }
  const rows = db
    .query(
      `SELECT ticker FROM markets
       WHERE event_id IN (${placeholders}) AND ticker != ''
       ORDER BY ticker ASC`,
    )
    .all(params) as Array<{ ticker: string }>;
  return rows.map((r) => sqlBrand.marketTicker(r.ticker));
}

/**
 * Recorder target set: watch-set events + all market tickers under those event_ids.
 * Prefer this over vanity --top volume sampling when aging live books.
 */
export function listRecordTickers(
  db: Database,
  options: WatchSetOptions = {},
): RecordTickersResult {
  const events = listWatchEvents(db, {
    leadMinutes: options.leadMinutes,
    limit: options.limit,
    pastGraceHours: options.pastGraceHours,
    staleMs: options.staleMs,
    nowMs: options.nowMs,
    clearStale: options.clearStale,
  });
  const eventIds = events.map((e) => e.eventId);
  const tickers = listMarketTickersForEventIds(db, eventIds);
  return { events, eventIds, tickers };
}
