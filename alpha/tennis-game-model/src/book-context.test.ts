// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { asKalshiMarketTicker, unbrand } from "../../../src/institutions/event-store/brands.ts";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import {
  latestBookTickForTicker,
  latestBookTicksForWatchSet,
} from "./book-context.ts";

const TICKER = "KXITFMATCH-26JUL22AAA-BBB";
const BOOK_JSON = JSON.stringify({
  ts: 2000,
  bids: [{ priceCents: 48, size: 50 }],
  asks: [{ priceCents: 52, size: 100 }],
  seq: 3,
});

function seedEventStore(db: ReturnType<typeof openEventStore>): void {
  db.query(
    `INSERT INTO events (
       event_id, tour, level, tournament, location, surface, court, round, best_of,
       player_a, player_b, winner, loser, start_ts, outcome, score_text,
       source, source_url, fetched_ts, source_row_hash, ingested_at, corpus
     ) VALUES (
       'evt1', 'ITF-M', '', '', '', '', '', '', NULL,
       'A', 'B', '', '', '2026-07-22T11:55:00.000Z', 'scheduled', '',
       'kalshi-api', '', 0, 'h1', 0, 'trading'
     )`,
  ).run();
  db.query(
    `INSERT INTO markets (
       market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
       competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts
     ) VALUES (
       'm1', 'evt1', 'kalshi', $ticker, 'KXITFMATCH', 'match_winner',
       'A', 'AAA', NULL, '', NULL, 'kalshi-api', '', 0
     )`,
  ).run({ $ticker: TICKER });
}

function insertTick(
  db: ReturnType<typeof openEventStore>,
  source: string,
  ts: number,
  recvTs: number,
  sourceClock: string,
  levelsJson: string,
): void {
  db.query(
    `INSERT INTO book_ticks (
       event_id, ticker, market_kind, ts, recv_ts, source_clock, seq, levels_json, source, source_url
     ) VALUES (
       'evt1', $ticker, 'match_winner', $ts, $recv_ts, $source_clock, 1, $levels_json, $source, ''
     )`,
  ).run({
    $ticker: TICKER,
    $ts: ts,
    $recv_ts: recvTs,
    $source_clock: sourceClock,
    $levels_json: levelsJson,
    $source: source,
  });
}

describe("book-context", () => {
  test("prefers kalshi-ws over kalshi-rest for latest tick", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedEventStore(db);
    insertTick(
      db,
      "kalshi-rest",
      1000,
      1000,
      "recv",
      JSON.stringify({
        ts: 1000,
        bids: [{ priceCents: 40, size: 10 }],
        asks: [{ priceCents: 44, size: 10 }],
        seq: 1,
      }),
    );
    insertTick(
      db,
      "kalshi-ws",
      2000,
      2001,
      "exchange",
      BOOK_JSON,
    );

    const ctx = latestBookTickForTicker(db, asKalshiMarketTicker(TICKER));
    expect(ctx).not.toBeNull();
    expect(ctx!.source).toBe("kalshi-ws");
    expect(ctx!.sourceClock).toBe("exchange");
    expect(ctx!.recvTs).toBe(2001);
    expect(ctx!.midCents).toBe(50);
    expect(ctx!.spreadCents).toBe(4);
    expect(unbrand(ctx!.eventId)).toBe("evt1");
  });

  test("falls back to kalshi-rest when no ws tick", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedEventStore(db);
    insertTick(
      db,
      "kalshi-rest",
      1500,
      1500,
      "recv",
      BOOK_JSON,
    );

    const ctx = latestBookTickForTicker(db, asKalshiMarketTicker(TICKER));
    expect(ctx!.source).toBe("kalshi-rest");
    expect(ctx!.sourceClock).toBe("recv");
  });

  test("latestBookTicksForWatchSet returns tick for watch-set ticker", () => {
    const nowMs = Date.parse("2026-07-22T12:00:00.000Z");
    const db = openEventStore({ dbPath: ":memory:" });
    seedEventStore(db);
    insertTick(db, "kalshi-ws", 2000, 2000, "recv", BOOK_JSON);

    const rows = latestBookTicksForWatchSet(db, { leadMinutes: 60, limit: 10, nowMs });
    expect(rows.length).toBe(1);
    expect(unbrand(rows[0]!.ticker)).toBe(TICKER);
    expect(rows[0]!.midCents).toBe(50);
  });
});
