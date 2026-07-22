// @see https://bun.com/docs/runtime/sqlite
/**
 * Latest book_ticks from event-store — prefer kalshi-ws, else kalshi-rest.
 */
import type { Database } from "bun:sqlite";
import type { BookSnapshot } from "../../../src/institutions/alpha-signal-types.ts";
import { midFromBookSnapshot } from "../../../src/bot/kalshi-book-parse.ts";
import {
  asCanonicalEventId,
  asKalshiMarketTicker,
  type CanonicalEventId,
  type KalshiMarketTicker,
  unbrand,
} from "../../../src/institutions/event-store/brands.ts";
import { listRecordTickers } from "../../../src/institutions/event-store/watch-set.ts";

export type BookTickContext = {
  ticker: KalshiMarketTicker;
  eventId: CanonicalEventId;
  book: BookSnapshot;
  midCents: number | null;
  spreadCents: number | null;
  source: string;
  sourceClock: string;
  recvTs: number | null;
  ts: number;
};

type BookTickRow = {
  event_id: string;
  ticker: string;
  ts: number;
  recv_ts: number | null;
  source_clock: string;
  seq: number | null;
  levels_json: string;
  source: string;
};

function parseBook(json: string, ts: number, seq: number | null): BookSnapshot | null {
  try {
    const book = JSON.parse(json) as BookSnapshot;
    return {
      ...book,
      ts: book.ts ?? ts,
      seq: book.seq ?? seq ?? 0,
    };
  } catch {
    return null;
  }
}

function spreadCents(book: BookSnapshot): number | null {
  if (book.crossed) return null;
  const bestBid = book.bids[0]?.priceCents;
  const bestAsk = book.asks[0]?.priceCents;
  if (bestBid == null || bestAsk == null) return null;
  return bestAsk - bestBid;
}

function rowToContext(row: BookTickRow): BookTickContext | null {
  const book = parseBook(row.levels_json, row.ts, row.seq);
  if (!book) return null;
  const ticker = asKalshiMarketTicker(row.ticker);
  return {
    ticker,
    eventId: asCanonicalEventId(row.event_id),
    book,
    midCents: midFromBookSnapshot(book),
    spreadCents: spreadCents(book),
    source: row.source,
    sourceClock: row.source_clock,
    recvTs: row.recv_ts,
    ts: row.ts,
  };
}

const LATEST_BY_SOURCE_SQL = `
  SELECT event_id, ticker, ts, recv_ts, source_clock, seq, levels_json, source
  FROM book_ticks
  WHERE ticker = $ticker AND source = $source
  ORDER BY id DESC
  LIMIT 1
`;

/** Prefer kalshi-ws when present; else kalshi-rest. */
export function latestBookTickForTicker(
  db: Database,
  ticker: KalshiMarketTicker,
): BookTickContext | null {
  for (const source of ["kalshi-ws", "kalshi-rest"] as const) {
    const row = db.query(LATEST_BY_SOURCE_SQL).get({
      $ticker: unbrand(ticker),
      $source: source,
    }) as BookTickRow | null;
    if (row) return rowToContext(row);
  }
  return null;
}

export function latestBookTicksForWatchSet(
  db: Database,
  options: { leadMinutes?: number; limit?: number; nowMs?: number } = {},
): BookTickContext[] {
  const watch = listRecordTickers(db, options);
  const out: BookTickContext[] = [];
  for (const ticker of watch.tickers) {
    const ctx = latestBookTickForTicker(db, ticker);
    if (ctx) out.push(ctx);
  }
  return out;
}
