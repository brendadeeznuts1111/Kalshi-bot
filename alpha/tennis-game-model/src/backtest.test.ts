// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import { tempSqlitePath, unlinkSqlite } from "../../../tests/tmp-db.ts";
import { runBacktest } from "./backtest.ts";

const TICKER_TRADING = "KXITFMATCH-26JUL22AAA-BBB";
const TICKER_RESEARCH = "KXITFMATCH-26JUL22CCC-DDD";

function seedResolvedEvent(
  db: ReturnType<typeof openEventStore>,
  opts: { eventId: string; ticker: string; corpus: string; startMs: number; tickMs: number },
): void {
  const { eventId, ticker, corpus, startMs, tickMs } = opts;
  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus
    ) VALUES (
      $id, 'ITF-M', 'KXITFMATCH', 't', '', 'Hard', '', 'r', 3,
      'Alice', 'Bob', 'Bob', 'Alice', $start, 'completed', 'test', '', $now,
      $hash, $now, $corpus
    )`,
  ).run({
    $id: eventId,
    $start: new Date(startMs).toISOString(),
    $now: tickMs,
    $hash: `h-${eventId}`,
    $corpus: corpus,
  });
  db.query(
    `INSERT INTO markets (market_id, event_id, venue, ticker, series, market_kind, side_code, yes_side_label, source)
     VALUES ($mid, $id, 'kalshi', $ticker, 'KXITFMATCH', 'match_winner', 'BBB', 'Bob', 'test')`,
  ).run({ $mid: `kalshi:${eventId}`, $id: eventId, $ticker: ticker });
  db.query(
    `INSERT INTO resolutions (event_id, outcome, winner, source, corpus, resolved_ts)
     VALUES ($id, 1, 'Bob', 'test', $corpus, $resolved)`,
  ).run({ $id: eventId, $corpus: corpus, $resolved: new Date(startMs + 7200_000).toISOString() });
  const book = JSON.stringify({
    ts: tickMs,
    seq: 1,
    bids: [{ priceCents: 44, size: 10 }],
    asks: [{ priceCents: 46, size: 10 }],
  });
  db.query(
    `INSERT INTO book_ticks (event_id, ticker, ts, recv_ts, source_clock, seq, levels_json, source, source_url)
     VALUES ($id, $ticker, $ts, $ts, 'recv', 1, $book, 'kalshi-rest', '')`,
  ).run({ $id: eventId, $ticker: ticker, $ts: tickMs, $book: book });
}

describe("backtest corpus filter", () => {
  let dbPath = "";

  afterEach(() => {
    if (dbPath) unlinkSqlite(dbPath);
    dbPath = "";
  });

  test("research-only resolutions never feed evaluation rows", () => {
    dbPath = tempSqlitePath("backtest-corpus");
    const now = Date.now();
    const db = openEventStore({ dbPath });
    seedResolvedEvent(db, {
      eventId: "itf|backtest|trading-1",
      ticker: TICKER_TRADING,
      corpus: "trading",
      startMs: now + 3600_000, // tick is pre-match
      tickMs: now,
    });
    seedResolvedEvent(db, {
      eventId: "itf|backtest|research-1",
      ticker: TICKER_RESEARCH,
      corpus: "research-only",
      startMs: now + 3600_000,
      tickMs: now,
    });
    db.close();

    const summary = runBacktest(dbPath);
    expect(summary.rows).toBe(1);
    expect(summary.distinctEvents).toBe(1);
    // Sole row is the trading event; research-only event is skipped.
    expect(summary.preMatch.rows).toBe(1);
    // Both players unknown to the corpus → no independent information →
    // vacuous, and the summary must not claim fills/edge from it.
    expect(summary.vacuous).toBe(1);
    expect(summary.fills).toBe(0);
    expect(summary.selfPrior.rows).toBe(0);
  });

  test("pre-match row with known players is NOT vacuous and scores self-prior Brier", () => {
    dbPath = tempSqlitePath("backtest-prior");
    const now = Date.now();
    const db = openEventStore({ dbPath });
    // Bob (YES) has a corpus history resolved BEFORE the tick.
    db.query(
      `INSERT INTO events (
        event_id, tour, level, tournament, location, surface, court, round, best_of,
        player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
        source_row_hash, ingested_at, corpus, score_text
      ) VALUES (
        'itf|backtest|hist-1', 'ITF-M', 'itf pro wtt - men''s 15', 't', '', 'Hard', '', 'r', 3,
        'Bob', 'Charlie', 'Bob', 'Charlie', $hstart, 'completed', 'itf-stadion', '', $now,
        'h-hist-1', $now, 'trading', '6-2 6-2'
      )`,
    ).run({ $hstart: new Date(now - 86400_000).toISOString(), $now: now - 86000_000 });
    db.query(
      `INSERT INTO resolutions (event_id, outcome, winner, source, corpus, resolved_ts)
       VALUES ('itf|backtest|hist-1', 1, 'Bob', 'itf-stadion', 'trading', $resolved)`,
    ).run({ $resolved: new Date(now - 86400_000).toISOString() });
    seedResolvedEvent(db, {
      eventId: "itf|backtest|trading-2",
      ticker: TICKER_TRADING,
      corpus: "trading",
      startMs: now + 3600_000,
      tickMs: now,
    });
    db.close();

    const summary = runBacktest(dbPath);
    expect(summary.rows).toBe(1);
    // One known player → the pre-match row carries independent information.
    expect(summary.vacuous).toBe(0);
    expect(summary.selfPrior.rows).toBe(1);
    expect(summary.selfPrior.brier).toBeGreaterThanOrEqual(0);
  });

  test("empty coverage is reported, not silently empty", () => {
    dbPath = tempSqlitePath("backtest-empty");
    const db = openEventStore({ dbPath });
    db.close();
    const summary = runBacktest(dbPath);
    expect(summary.rows).toBe(0);
    expect(summary.coverage).toBe("insufficient");
  });
});
