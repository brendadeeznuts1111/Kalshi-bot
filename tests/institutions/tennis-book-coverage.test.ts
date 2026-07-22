// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { analyzeTennisBookCoverage } from "../../src/institutions/event-store/tennis-book-coverage.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";

describe("tennis-book-coverage", () => {
  test("counts ws/rest per watch ticker and exchange clock share", () => {
    const nowMs = Date.parse("2026-07-22T12:00:00.000Z");
    const db = openEventStore({ dbPath: ":memory:" });
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
         'm1', 'evt1', 'kalshi', 'KXITFMATCH-26JUL22AAA-BBB', 'KXITFMATCH', 'match_winner',
         'A', 'AAA', NULL, '', NULL, 'kalshi-api', '', 0
       )`,
    ).run();
    db.query(
      `INSERT INTO book_ticks (
         event_id, ticker, market_kind, ts, recv_ts, source_clock, seq, levels_json, source, source_url
       ) VALUES
         ('evt1', 'KXITFMATCH-26JUL22AAA-BBB', 'match_winner', 1000, 1000, 'recv', 1, '{}', 'kalshi-ws', ''),
         ('evt1', 'KXITFMATCH-26JUL22AAA-BBB', 'match_winner', 1001, 1002, 'exchange', 2, '{}', 'kalshi-ws', ''),
         ('evt1', 'KXITFMATCH-26JUL22AAA-BBB', 'match_winner', 1003, 1003, 'recv', NULL, '{}', 'kalshi-rest', '')`,
    ).run();

    const report = analyzeTennisBookCoverage(db, { leadMinutes: 60, limit: 10, nowMs });
    expect(report.watchTickers).toBe(1);
    expect(report.watchWithWs).toBe(1);
    expect(report.watchWithRest).toBe(1);
    expect(report.watchWithBoth).toBe(1);
    expect(report.wsTicksTotal).toBe(2);
    expect(report.wsExchangeClockPct).toBe(50);
  });
});
