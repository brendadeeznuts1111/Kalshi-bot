// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  asCompetitorId,
  asKalshiEventTicker,
  asKalshiMarketTicker,
  asSeriesTicker,
} from "../../src/institutions/event-store/brands.ts";
import { mintKalshiCompetitorEventId } from "../../src/institutions/event-store/kalshi-event-id.ts";
import {
  LIVE_STALE_MS,
  listWatchEvents,
} from "../../src/institutions/event-store/live-scores.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { asCanonicalEventId } from "../../src/institutions/event-store/types.ts";
import {
  listMarketTickersForEventIds,
  listRecordTickers,
} from "../../src/institutions/event-store/watch-set.ts";

const competitor1Id = asCompetitorId("9eface64-a579-436d-8717-50f2730400e2");
const competitor2Id = asCompetitorId("2b652366-a7ff-4cc9-8ab9-8a0ba31b68ed");

describe("watch-set", () => {
  test("listRecordTickers selects markets under lead-aligned watch-set", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    const nearTs = new Date(now + 2 * 60_000).toISOString();
    const farTs = new Date(now + 60 * 60_000).toISOString();
    const nearId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs: nearTs,
    });
    const farId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: asCompetitorId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      competitorB: asCompetitorId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
      startTs: farTs,
    });
    const liveFarId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFMATCH"),
      competitorA: asCompetitorId("cccccccc-cccc-cccc-cccc-cccccccccccc"),
      competitorB: asCompetitorId("dddddddd-dddd-dddd-dddd-dddddddddddd"),
      startTs: farTs,
    });

    const insertEvent = (
      id: string,
      start: string,
      ticker: string,
      series: string,
      players: [string, string],
    ) => {
      db.query(
        `INSERT INTO events (
          event_id, tour, level, tournament, location, surface, court, round, best_of,
          player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
          source_row_hash, ingested_at, corpus
        ) VALUES (
          $id, 'ITF', $series, 'W', '', 'Hard', '', 'R32', NULL,
          $a, $b, '', '', $start, 'scheduled', 'kalshi-api', '', $now,
          $hash, $now, 'trading'
        )`,
      ).run({
        $id: id,
        $series: series,
        $a: players[0],
        $b: players[1],
        $start: start,
        $now: now,
        $hash: `watch|${ticker}`,
      });
      db.query(
        `INSERT INTO markets (
          market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
          competitor_id, source, fetched_ts
        ) VALUES
          ('kalshi:${ticker}-A', $id, 'kalshi', '${ticker}-A', $series, 'match_winner',
           $a, 'A', NULL, 'kalshi-api', $now),
          ('kalshi:${ticker}-B', $id, 'kalshi', '${ticker}-B', $series, 'match_winner',
           $b, 'B', NULL, 'kalshi-api', $now)`,
      ).run({ $id: id, $series: series, $a: players[0], $b: players[1], $now: now });
    };

    insertEvent(nearId, nearTs, "KXITFWMATCH-26JUL22NEAR", "KXITFWMATCH", ["NearA", "NearB"]);
    insertEvent(farId, farTs, "KXITFWMATCH-26JUL22FAR", "KXITFWMATCH", ["FarA", "FarB"]);
    insertEvent(liveFarId, farTs, "KXITFMATCH-26JUL22LIVE", "KXITFMATCH", ["LiveA", "LiveB"]);
    db.query(
      `INSERT INTO live_scores (
         event_id, event_ticker, milestone_id, updated_ts, source_clock, status, match_status,
         sets_home, sets_away, games_home, games_away, points_home, points_away,
         server_competitor_id, competitor1_id, competitor2_id, is_live, details_json,
         source, source_url, fetched_ts
       ) VALUES (
         $id, 'KXITFMATCH-26JUL22LIVE', 'm1', $now, 'recv', 'in_progress', 'in_progress',
         0, 0, 1, 0, 30, 0, NULL, NULL, NULL, 1, '{}',
         'kalshi-live-data', '', $now
       )`,
    ).run({ $id: liveFarId, $now: now });

    expect(listWatchEvents(db, { leadMinutes: 5 })).toHaveLength(2);

    const { events, eventIds, tickers } = listRecordTickers(db, { leadMinutes: 5, limit: 40 });
    expect(events.map((e) => e.eventTicker).sort()).toEqual([
      asKalshiEventTicker("KXITFMATCH-26JUL22LIVE"),
      asKalshiEventTicker("KXITFWMATCH-26JUL22NEAR"),
    ]);
    expect(eventIds).toContain(asCanonicalEventId(nearId));
    expect(eventIds).toContain(asCanonicalEventId(liveFarId));
    expect(eventIds).not.toContain(asCanonicalEventId(farId));
    expect(tickers.sort()).toEqual([
      asKalshiMarketTicker("KXITFMATCH-26JUL22LIVE-A"),
      asKalshiMarketTicker("KXITFMATCH-26JUL22LIVE-B"),
      asKalshiMarketTicker("KXITFWMATCH-26JUL22NEAR-A"),
      asKalshiMarketTicker("KXITFWMATCH-26JUL22NEAR-B"),
    ]);
    expect(listMarketTickersForEventIds(db, [asCanonicalEventId(farId)])).toEqual([
      asKalshiMarketTicker("KXITFWMATCH-26JUL22FAR-A"),
      asKalshiMarketTicker("KXITFWMATCH-26JUL22FAR-B"),
    ]);
  });

  test("listRecordTickers clearStale:false is read-only (dry-run safe)", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    const startTs = new Date(now + 60 * 60_000).toISOString();
    const eventId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs,
    });
    db.query(
      `INSERT INTO events (
        event_id, tour, level, tournament, location, surface, court, round, best_of,
        player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
        source_row_hash, ingested_at, corpus
      ) VALUES (
        $id, 'ITF-W', 'KXITFWMATCH', 't', '', 'Hard', '', 'R', NULL,
        'A', 'B', '', '', $start, 'scheduled', 'kalshi-api', '', $now,
        $hash, $now, 'trading'
      )`,
    ).run({ $id: eventId, $start: startTs, $now: now, $hash: "dry-watch" });
    db.query(
      `INSERT INTO markets (
        market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
        competitor_id, source, fetched_ts
      ) VALUES ('kalshi:KXITFWMATCH-DRY-A', $id, 'kalshi', 'KXITFWMATCH-DRY-A', 'KXITFWMATCH',
        'match_winner', 'A', 'A', $c1, 'kalshi-api', $now)`,
    ).run({ $id: eventId, $c1: competitor1Id, $now: now });
    const staleUpdated = now - LIVE_STALE_MS - 1_000;
    db.query(
      `INSERT INTO live_scores (
         event_id, event_ticker, milestone_id, updated_ts, source_clock, status, match_status,
         sets_home, sets_away, games_home, games_away, points_home, points_away,
         server_competitor_id, competitor1_id, competitor2_id, is_live, details_json,
         source, source_url, fetched_ts
       ) VALUES (
         $id, 'KXITFWMATCH-DRY', 'm1', $old, 'recv', 'in_progress', 'in_progress',
         0, 0, 1, 0, 30, 0, NULL, $c1, $c2, 1, '{}',
         'kalshi-live-data', '', $old
       )`,
    ).run({ $id: eventId, $old: staleUpdated, $c1: competitor1Id, $c2: competitor2Id });

    const { tickers } = listRecordTickers(db, {
      leadMinutes: 5,
      nowMs: now,
      clearStale: false,
    });
    expect(tickers).toEqual([]);
    const live = db
      .query(`SELECT is_live FROM live_scores WHERE event_id = $id`)
      .get({ $id: eventId }) as { is_live: number };
    expect(live.is_live).toBe(1);
  });
});
