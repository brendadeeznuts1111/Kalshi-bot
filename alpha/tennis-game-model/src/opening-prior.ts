/**
 * Opening book mid — first book_tick for ticker (anchors pre-match prior).
 */
import type { Database } from "bun:sqlite";
import { midFromBookSnapshot } from "../../../src/bot/kalshi-book-parse.ts";
import type { BookSnapshot } from "../../../src/institutions/alpha-signal-types.ts";
import {
  type CanonicalEventId,
  type KalshiMarketTicker,
  unbrand,
} from "../../../src/institutions/event-store/brands.ts";

type TickRow = {
  levels_json: string;
  ts: number;
  seq: number | null;
};

function parseBook(json: string, ts: number, seq: number | null): BookSnapshot | null {
  try {
    const book = JSON.parse(json) as BookSnapshot;
    return { ...book, ts: book.ts ?? ts, seq: book.seq ?? seq ?? 0 };
  } catch {
    return null;
  }
}

/** First recorded mid (cents) for this market — prefer kalshi-ws then kalshi-rest. */
export function openingMidCents(
  db: Database,
  ticker: KalshiMarketTicker,
  eventId: CanonicalEventId,
): number | null {
  for (const source of ["kalshi-ws", "kalshi-rest"] as const) {
    const row = db
      .query(
        `SELECT levels_json, ts, seq FROM book_ticks
         WHERE ticker = $ticker AND event_id = $event_id AND source = $source
         ORDER BY id ASC LIMIT 1`,
      )
      .get({
        $ticker: unbrand(ticker),
        $event_id: unbrand(eventId),
        $source: source,
      }) as TickRow | null;
    if (!row) continue;
    const book = parseBook(row.levels_json, row.ts, row.seq);
    if (!book) continue;
    const mid = midFromBookSnapshot(book);
    if (mid != null) return mid;
  }
  return null;
}

export function openingPriorP(
  db: Database,
  ticker: KalshiMarketTicker,
  eventId: CanonicalEventId,
): number | null {
  const mid = openingMidCents(db, ticker, eventId);
  return mid == null ? null : mid / 100;
}
