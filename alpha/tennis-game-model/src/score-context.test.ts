// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  asCanonicalEventId,
  asCompetitorId,
  asKalshiMarketTicker,
} from "../../../src/institutions/event-store/brands.ts";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import { loadScoreContext } from "./score-context.ts";

const EVENT_ID = "evt-score-1";
const TICKER = "KXITFMATCH-26JUL22AAABBB-BBB";
const COMPETITOR_YES = asCompetitorId("11111111-1111-1111-1111-111111111111");
const COMPETITOR_NO = asCompetitorId("22222222-2222-2222-2222-222222222222");

function seedEventStore(db: ReturnType<typeof openEventStore>): void {
  db.query(
    `INSERT INTO events (
       event_id, tour, level, tournament, location, surface, court, round, best_of,
       player_a, player_b, winner, loser, start_ts, outcome, score_text,
       source, source_url, fetched_ts, source_row_hash, ingested_at, corpus
     ) VALUES (
       $event_id, 'ITF-M', '', '', '', '', '', '', NULL,
       'Alice', 'Bob', '', '', '2026-07-22T11:55:00.000Z', 'scheduled', '',
       'kalshi-api', '', 0, 'h-score', 0, 'trading'
     )`,
  ).run({ $event_id: EVENT_ID });
  db.query(
    `INSERT INTO markets (
       market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
       competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts
     ) VALUES (
       'm-yes', $event_id, 'kalshi', $ticker, 'KXITFMATCH', 'match_winner',
       'Bob', 'BBB', $c_yes, '', NULL, 'kalshi-api', '', 0
     )`,
  ).run({
    $event_id: EVENT_ID,
    $ticker: TICKER,
    $c_yes: COMPETITOR_YES,
  });
  db.query(
    `INSERT INTO markets (
       market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
       competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts
     ) VALUES (
       'm-no', $event_id, 'kalshi', 'KXITFMATCH-26JUL22AAABBB-AAA', 'KXITFMATCH', 'match_winner',
       'Alice', 'AAA', $c_no, '', NULL, 'kalshi-api', '', 0
     )`,
  ).run({
    $event_id: EVENT_ID,
    $c_no: COMPETITOR_NO,
  });
}

function insertLiveScore(
  db: ReturnType<typeof openEventStore>,
  options: {
    isLive?: boolean;
    setsHome?: number;
    setsAway?: number;
    gamesHome?: number;
    gamesAway?: number;
  } = {},
): void {
  db.query(
    `INSERT INTO live_scores (
       event_id, event_ticker, milestone_id, updated_ts, source_clock, status, match_status,
       sets_home, sets_away, games_home, games_away, points_home, points_away,
       server_competitor_id, competitor1_id, competitor2_id, is_live, details_json,
       source, source_url, fetched_ts
     ) VALUES (
       $event_id, 'KXITFMATCH-26JUL22AAABBB', 'ms1', 1000, 'recv', 'in_progress', 'live',
       $sets_home, $sets_away, $games_home, $games_away, 0, 0,
       NULL, $c1, $c2, $is_live, '{}',
       'kalshi-live-data', '', 1000
     )`,
  ).run({
    $event_id: EVENT_ID,
    $sets_home: options.setsHome ?? 1,
    $sets_away: options.setsAway ?? 0,
    $games_home: options.gamesHome ?? 4,
    $games_away: options.gamesAway ?? 2,
    $c1: COMPETITOR_YES,
    $c2: COMPETITOR_NO,
    $is_live: options.isLive === false ? 0 : 1,
  });
}

describe("score-context", () => {
  test("returns null when no live_scores row", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedEventStore(db);
    const ctx = loadScoreContext(
      db,
      asCanonicalEventId(EVENT_ID),
      asKalshiMarketTicker(TICKER),
    );
    expect(ctx).toBeNull();
  });

  test("maps YES side to home score axes via competitor_id", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedEventStore(db);
    insertLiveScore(db, { setsHome: 1, setsAway: 0, gamesHome: 5, gamesAway: 3 });

    const ctx = loadScoreContext(
      db,
      asCanonicalEventId(EVENT_ID),
      asKalshiMarketTicker(TICKER),
    );
    expect(ctx).toEqual({
      setsYes: 1,
      setsNo: 0,
      gamesYes: 5,
      gamesNo: 3,
      isLive: true,
    });
  });

  test("maps YES on away competitor to away score axes", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedEventStore(db);
    insertLiveScore(db, {
      setsHome: 0,
      setsAway: 1,
      gamesHome: 2,
      gamesAway: 4,
    });

    db.query(
      `UPDATE live_scores SET competitor1_id = $c1, competitor2_id = $c2 WHERE event_id = $id`,
    ).run({
      $id: EVENT_ID,
      $c1: COMPETITOR_NO,
      $c2: COMPETITOR_YES,
    });

    const ctx = loadScoreContext(
      db,
      asCanonicalEventId(EVENT_ID),
      asKalshiMarketTicker(TICKER),
    );
    expect(ctx).toEqual({
      setsYes: 1,
      setsNo: 0,
      gamesYes: 4,
      gamesNo: 2,
      isLive: true,
    });
  });

  test("preserves isLive=false for pre-match score row", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedEventStore(db);
    insertLiveScore(db, { isLive: false });

    const ctx = loadScoreContext(
      db,
      asCanonicalEventId(EVENT_ID),
      asKalshiMarketTicker(TICKER),
    );
    expect(ctx?.isLive).toBe(false);
  });
});
