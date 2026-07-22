// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  applyOrderbookDelta,
  applyOrderbookSnapshot,
  createEmptyLiveOrderbook,
  liveOrderbookToSnapshot,
} from "../../src/institutions/event-store/orderbook-live.ts";
import { handleOrderbookWire } from "../../src/institutions/event-store/kalshi-ws-recorder.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";

describe("orderbook-live", () => {
  test("snapshot then delta rebuilds book; seq gap clears ready", () => {
    const book = createEmptyLiveOrderbook("KXITFMATCH-26JUL22AAA-BBB");
    applyOrderbookSnapshot(
      book,
      {
        market_ticker: "KXITFMATCH-26JUL22AAA-BBB",
        yes_dollars_fp: [["0.40", "10.00"], ["0.35", "5.00"]],
        no_dollars_fp: [["0.55", "8.00"]],
      },
      2,
    );
    expect(book.ready).toBe(true);
    expect(book.yes.get(40)).toBe(10);
    const snap = liveOrderbookToSnapshot(book, 1_000);
    expect(snap?.bids[0]?.priceCents).toBe(40);
    // YES ask from NO bid 55¢ → 45¢
    expect(snap?.asks[0]?.priceCents).toBe(45);

    expect(
      applyOrderbookDelta(
        book,
        {
          market_ticker: "KXITFMATCH-26JUL22AAA-BBB",
          price_dollars: "0.40",
          delta_fp: "-10.00",
          side: "yes",
        },
        3,
      ),
    ).toBe(true);
    expect(book.yes.has(40)).toBe(false);

    // seq gap
    expect(
      applyOrderbookDelta(
        book,
        {
          market_ticker: "KXITFMATCH-26JUL22AAA-BBB",
          price_dollars: "0.30",
          delta_fp: "1.00",
          side: "yes",
        },
        9,
      ),
    ).toBe(false);
    expect(book.ready).toBe(false);
  });
});

describe("handleOrderbookWire dual-clock", () => {
  test("delta with ts_ms stamps source_clock=exchange and ts=ts_ms", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    db.query(
      `INSERT INTO events (
         event_id, tour, level, tournament, location, surface, court, round, best_of,
         player_a, player_b, winner, loser, start_ts, outcome, score_text,
         source, source_url, fetched_ts, source_row_hash, ingested_at, corpus
       ) VALUES (
         'evt1', 'ITF-M', '', '', '', '', '', '', NULL,
         'A', 'B', '', '', '2026-07-22T10:00:00Z', 'scheduled', '',
         'kalshi-api', '', 0, 'h1', 0, 'trading'
       )`,
    ).run();
    db.query(
      `INSERT INTO markets (
         market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
         competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts
       ) VALUES (
         'm1', 'evt1', 'kalshi', 'KXITFMATCH-26JUL22AAA-BBB', 'KXITFMATCH', 'match_winner',
         'A', 'AAA', NULL, '', NULL, 'kalshi-api', '', 0
       )`,
    ).run();

    const books = new Map();
    handleOrderbookWire(
      db,
      books,
      {
        type: "orderbook_snapshot",
        seq: 1,
        msg: {
          market_ticker: "KXITFMATCH-26JUL22AAA-BBB",
          yes_dollars_fp: [["0.40", "10.00"]],
          no_dollars_fp: [["0.50", "10.00"]],
        },
      },
      1_700_000_000_000,
    );
    handleOrderbookWire(
      db,
      books,
      {
        type: "orderbook_delta",
        seq: 2,
        msg: {
          market_ticker: "KXITFMATCH-26JUL22AAA-BBB",
          price_dollars: "0.41",
          delta_fp: "3.00",
          side: "yes",
          ts_ms: 1_700_000_000_500,
        },
      },
      1_700_000_000_999,
    );

    const rows = db
      .query(
        `SELECT ts, recv_ts, source_clock, source, seq FROM book_ticks ORDER BY id ASC`,
      )
      .all() as Array<{
      ts: number;
      recv_ts: number;
      source_clock: string;
      source: string;
      seq: number;
    }>;
    expect(rows.length).toBe(2);
    expect(rows[0]!.source_clock).toBe("recv");
    expect(rows[0]!.source).toBe("kalshi-ws");
    expect(rows[1]!.source_clock).toBe("exchange");
    expect(rows[1]!.ts).toBe(1_700_000_000_500);
    expect(rows[1]!.recv_ts).toBe(1_700_000_000_999);
    expect(rows[1]!.seq).toBe(2);
  });
});
