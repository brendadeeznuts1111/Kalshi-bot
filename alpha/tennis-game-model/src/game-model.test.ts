// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import {
  asCanonicalEventId,
  asKalshiMarketTicker,
} from "../../../src/institutions/event-store/brands.ts";
import { buildGameModelP } from "./game-model.ts";
import type { ScoreContext } from "./score-context.ts";

function seedEventWithBook(db: ReturnType<typeof openEventStore>): {
  eventId: ReturnType<typeof asCanonicalEventId>;
  ticker: ReturnType<typeof asKalshiMarketTicker>;
} {
  const eventId = asCanonicalEventId("itf|game-model|test-1");
  const ticker = asKalshiMarketTicker("KXITFMATCH-26JUL22AAA-BBB");
  const now = Date.now();
  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus
    ) VALUES (
      $id, 'ITF-M', 'KXITFMATCH', 't', '', 'Hard', '', 'r', 3,
      'Alice', 'Bob', '', '', $start, 'scheduled', 'test', '', $now,
      'h', $now, 'trading'
    )`,
  ).run({ $id: eventId, $start: new Date(now).toISOString(), $now: now });
  db.query(
    `INSERT INTO markets (market_id, event_id, venue, ticker, series, side_code, yes_side_label, competitor_id, source)
     VALUES ('kalshi:test', $id, 'kalshi', $ticker, 'KXITFMATCH', 'BBB', 'Bob', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'test')`,
  ).run({ $id: eventId, $ticker: ticker });
  const book = JSON.stringify({
    ts: now,
    seq: 1,
    bids: [{ priceCents: 44, size: 10 }],
    asks: [{ priceCents: 46, size: 10 }],
  });
  db.query(
    `INSERT INTO book_ticks (event_id, ticker, ts, recv_ts, source_clock, seq, levels_json, source, source_url)
     VALUES ($id, $ticker, $ts, $ts, 'recv', 1, $book, 'kalshi-rest', '')`,
  ).run({ $id: eventId, $ticker: ticker, $ts: now, $book: book });
  return { eventId, ticker };
}

describe("game-model", () => {
  test("pre-match uses opening prior from first book_tick", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const { eventId, ticker } = seedEventWithBook(db);
    const result = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 50,
      score: null,
    });
    expect(result).not.toBeNull();
    expect(result!.pModel).toBeCloseTo(0.45, 2);
    expect(result!.components.model_kind).toBe(0);
  });

  test("live with server uses match Markov", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const { eventId, ticker } = seedEventWithBook(db);
    const now = Date.now();
    db.query(
      `INSERT INTO live_scores (
        event_id, event_ticker, milestone_id, status, is_live,
        sets_home, sets_away, games_home, games_away, points_home, points_away,
        server_competitor_id, competitor1_id, competitor2_id, updated_ts,
        source_clock, match_status, details_json, source, source_url, fetched_ts
      ) VALUES (
        $id, 'KXITFMATCH-26JUL22AAA', 'ms-test', 'live', 1,
        1, 0, 3, 2, 2, 1,
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', $now,
        'recv', 'live', '{}', 'test', '', $now
      )`,
    ).run({ $id: eventId, $now: now });
    db.query(
      `UPDATE markets SET competitor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE ticker = $ticker`,
    ).run({ $ticker: ticker });

    const score: ScoreContext = {
      setsYes: 1,
      setsNo: 0,
      gamesYes: 3,
      gamesNo: 2,
      pointsServer: 2,
      pointsReturner: 1,
      serverIsYes: true,
      bestOf: 3,
      isLive: true,
    };

    const result = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: 55,
      score,
    });
    expect(result!.components.model_kind).toBe(2);
    expect(result!.pModel).toBeGreaterThan(0.45);
  });
});
