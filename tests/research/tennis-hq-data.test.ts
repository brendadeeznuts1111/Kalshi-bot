import { describe, expect, test } from "bun:test";
import { asSeriesTicker } from "../../src/institutions/event-store/brands.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import type { CrossMarketOdds } from "../../src/institutions/event-store/types.ts";
import {
  buildTennisHqPayload,
  classifyTennisDataHealth,
  getPlayerDetail,
  loadTennisDataHealth,
} from "../../src/research/tennis-hq-data.ts";
import {
  computeSurfaceEdge,
  MIN_SURFACE_EDGE_APPEARANCES,
  normalizeTennisSurface,
} from "../../src/research/tennis-surface-edge.ts";
import type { TennisBoard } from "../../src/research/tennis-events.ts";
import { SPORT } from "../../src/institutions/market-registry/brands.ts";

const EVENT_TICKER = "KXITFMATCH-26JUL28RODGAM";
const TICKER_A = "KXITFMATCH-26JUL28RODGAM-ROD";
const TICKER_B = "KXITFMATCH-26JUL28RODGAM-GAM";
const COMPETITOR_A = "a1111111-1111-1111-1111-111111111111";
const COMPETITOR_B = "b2222222-2222-2222-2222-222222222222";
const EVENT_ID = "evt_rodgam";
const PLAYER_A = "Rodrigo Alves";
const PLAYER_B = "Gabriel Martinez";

function seedFixtureDb() {
  const db = openEventStore({ dbPath: ":memory:" });
  db.query(
    `INSERT INTO events (
       event_id, tour, level, tournament, location, surface, court, round, best_of,
       player_a, player_b, winner, loser, start_ts, outcome, score_text,
       source, source_url, fetched_ts, source_row_hash, ingested_at, corpus
     ) VALUES (
       $event_id, 'ITF-M', '', 'Test Open', '', 'Hard', '', 'R32', 3,
       $player_a, $player_b, '', '', '2026-07-28T18:00:00Z', 'scheduled', '',
       'kalshi-api', '', 0, 'hash-rodgam', 0, 'trading'
     )`,
  ).run({
    $event_id: EVENT_ID,
    $player_a: PLAYER_A,
    $player_b: PLAYER_B,
  });
  const insertHistory = db.query(
    `INSERT INTO events (
       event_id, tour, level, tournament, location, surface, court, round, best_of,
       player_a, player_b, winner, loser, start_ts, outcome, score_text,
       source, source_url, fetched_ts, source_row_hash, ingested_at, corpus
     ) VALUES (
       $event_id, 'ITF-M', '', 'History Open', '', 'Hard', '', 'R32', 3,
       $player_a, $player_b, $winner, $loser, $start_ts, 'completed', '6-4 6-4',
       'fixture', '', 0, $source_row_hash, 0, 'trading'
     )`,
  );
  for (let index = 0; index < 10; index++) {
    const playerAWon = index < 8;
    insertHistory.run({
      $event_id: `history_${index}`,
      $player_a: PLAYER_A,
      $player_b: PLAYER_B,
      $winner: playerAWon ? PLAYER_A : PLAYER_B,
      $loser: playerAWon ? PLAYER_B : PLAYER_A,
      $start_ts: `2026-06-${String(index + 1).padStart(2, "0")}T18:00:00Z`,
      $source_row_hash: `history-hash-${index}`,
    });
  }
  db.query(
    `INSERT INTO markets (
       market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
       competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts, volume_fp
     ) VALUES (
       'm1', $event_id, 'kalshi', $ticker_a, 'KXITFMATCH', 'match_winner',
       $player_a, 'ROD', $comp_a, '', NULL, 'kalshi-api', '', 0, '50000'
     )`,
  ).run({
    $event_id: EVENT_ID,
    $ticker_a: TICKER_A,
    $player_a: PLAYER_A,
    $comp_a: COMPETITOR_A,
  });
  db.query(
    `INSERT INTO markets (
       market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
       competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts, volume_fp
     ) VALUES (
       'm2', $event_id, 'kalshi', $ticker_b, 'KXITFMATCH', 'match_winner',
       $player_b, 'GAM', $comp_b, '', NULL, 'kalshi-api', '', 0, '42000'
     )`,
  ).run({
    $event_id: EVENT_ID,
    $ticker_b: TICKER_B,
    $player_b: PLAYER_B,
    $comp_b: COMPETITOR_B,
  });
  db.query(
    `INSERT INTO player_profiles (
       player_name, first_seen_ts, last_seen_ts, appearances, wins, losses, win_rate,
       surfaces, avg_kalshi_volume_fp, corpus
     ) VALUES (
       $name, 1000, 2000, 5, 3, 2, 0.6, '{"Hard":5}', 46000, 'trading'
     )`,
  ).run({ $name: PLAYER_A });
  db.query(
    `INSERT INTO live_scores (
       event_id, event_ticker, milestone_id, updated_ts, source_clock, status, match_status,
       sets_home, sets_away, games_home, games_away, points_home, points_away,
       server_competitor_id, competitor1_id, competitor2_id, is_live, details_json, source
     ) VALUES (
       $event_id, $event_ticker, 'ms-1', $updated_ts, 'recv', 'in_progress', '',
       1, 0, 3, 2, 30, 15, $comp_a, $comp_a, $comp_b, 1, '{}', 'kalshi-live-data'
     )`,
  ).run({
    $event_id: EVENT_ID,
    $event_ticker: EVENT_TICKER,
    $updated_ts: Date.now(),
    $comp_a: COMPETITOR_A,
    $comp_b: COMPETITOR_B,
  });
  db.query(
    `INSERT INTO book_ticks (
       event_id, ticker, market_kind, ts, recv_ts, source_clock, seq, levels_json, source, source_url
     ) VALUES (
       $event_id, $ticker, 'match_winner', $ts, $ts, 'recv', 1,
       '{"ts":1000,"seq":1,"bids":[{"priceCents":45,"size":12}],"asks":[{"priceCents":47,"size":10}]}',
       'kalshi-ws', ''
     )`,
  ).run({
    $event_id: EVENT_ID,
    $ticker: TICKER_A,
    $ts: Date.now(),
  });
  db.query(
    `INSERT INTO price_snapshots (
       event_id, ticker, ts, kalshi_volume_24h, kalshi_volume_lifetime,
       stale_volume, poly_prob, poly_volume_24h, poly_volume_lifetime,
       polymarket_event_id, polymarket_match_method,
       kalshi_series, event_type, participant_format,
       poly_observed_at_ms, poly_cache_state
     ) VALUES (
       $event_id, $ticker, $ts, 1900, 5000, 0, 0.62, 125.5, 900,
       'poly-1', 'surname', 'KXITFMATCH', 'match', 'singles', $ts, 'healthy'
     )`,
  ).run({
    $event_id: EVENT_ID,
    $ticker: TICKER_A,
    $ts: Date.now(),
  });
  return db;
}

function mockBoard(): TennisBoard {
  return {
    generatedAt: new Date().toISOString(),
    eventCount: 1,
    marketCount: 2,
    series: [
      {
        series: asSeriesTicker("KXITFMATCH"),
        state: "ok",
        events: [
          {
            sport: SPORT.tennis,
            eventTicker: EVENT_TICKER,
            title: `${PLAYER_A} vs ${PLAYER_B}`,
            subTitle: null,
            series: "KXITFMATCH",
            league: "ITF Men",
            tour: "ITF",
            level: "itf",
            tournament: "ITF M25",
            round: null,
            city: null,
            country: null,
            countryCode: null,
            tier: null,
            surface: null,
            competition: "ITF M25",
            occurrenceMs: Date.parse("2026-07-28T18:00:00Z"),
            markets: [
              {
                ticker: TICKER_A,
                player: PLAYER_A,
                playerCountry: null,
                playerCountryCode: null,
                status: "active",
                yesBidCents: 44,
                yesAskCents: 46,
                lastCents: 45,
                volume24h: 1000,
                openInterest: 800,
                competitorId: COMPETITOR_A,
              },
              {
                ticker: TICKER_B,
                player: PLAYER_B,
                playerCountry: null,
                playerCountryCode: null,
                status: "active",
                yesBidCents: 54,
                yesAskCents: 56,
                lastCents: 55,
                volume24h: 900,
                openInterest: 700,
                competitorId: COMPETITOR_B,
              },
            ],
          },
        ],
      },
    ],
  };
}

function mockBoardUnsynced(): TennisBoard {
  return {
    generatedAt: new Date().toISOString(),
    eventCount: 1,
    marketCount: 2,
    series: [
      {
        series: asSeriesTicker("KXITFMATCH"),
        state: "ok",
        events: [
          {
            sport: SPORT.tennis,
            eventTicker: "KXITFMATCH-26JUL99UNKNOWN",
            title: "Unknown vs Unknown",
            subTitle: null,
            series: "KXITFMATCH",
            league: "ITF Men",
            tour: "ITF",
            level: "itf",
            tournament: null,
            round: null,
            city: null,
            country: null,
            countryCode: null,
            tier: null,
            surface: null,
            competition: null,
            occurrenceMs: null,
            markets: [
              {
                ticker: "KXITFMATCH-26JUL99UNKNOWN-UNK",
                player: "Unknown Player",
                playerCountry: null,
                playerCountryCode: null,
                status: "active",
                yesBidCents: 50,
                yesAskCents: 52,
                lastCents: 51,
                volume24h: null,
                openInterest: null,
                competitorId: null,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("tennis-hq-data", () => {
  test("buildTennisHqPayload enriches board with store joins", async () => {
    const db = seedFixtureDb();
    const payload = await buildTennisHqPayload({
      nowMs: Date.now(),
      db,
      board: mockBoard(),
    });

    expect(payload.sources.kalshiBoard).toBe("ok");
    expect(payload.sources.eventStore).toBe("ok");
    expect(payload.sources.liveScores).toBe("ok");
    expect(payload.sources.books.wsWatch).toBe(1);
    expect(payload.dataHealth.state).toBe("healthy");
    expect(payload.dataHealth.matchedEvents).toBe(1);
    expect(payload.dataHealth.unmatchedEvents).toBe(0);
    expect(payload.dataHealth.kalshiVolume24h).toBe(1900);
    expect(payload.dataHealth.polymarketVolume24h).toBe(125.5);
    expect(payload.liveBoard).toHaveLength(1);

    const ev = payload.liveBoard[0]!;
    expect(ev.eventId).toBe(EVENT_ID);
    expect(ev.status).toBe("live");
    expect(ev.surface).toBe("Hard");
    expect(ev.surfaceEdge).toBe(42);
    expect(ev.surfaceEdgePlayers).toEqual([PLAYER_A, PLAYER_B]);
    expect(ev.surfaceEdgeSamples).toEqual([10, 10]);
    expect(ev.surfaceEdgeReliable).toBe(true);
    expect(ev.surfaceEdgeEvidence).toBe("ready");
    expect(ev.surfaceEdgeScaling).toBe("dampened");
    expect(ev.score).not.toBeNull();
    expect(ev.score!.sets).toEqual([1, 0]);
    expect(ev.score!.games).toEqual([3, 2]);

    const sideA = ev.sides.find((s) => s.ticker === TICKER_A)!;
    expect(sideA.book?.midCents).toBe(46);
    expect(sideA.book?.source).toBe("kalshi-ws");
    expect(sideA.profile?.playerName).toBe(PLAYER_A);
    expect(sideA.profile?.competitorIds).toContain(COMPETITOR_A);

    expect(payload.profilesIndex.total).toBeGreaterThanOrEqual(1);
    expect(payload.profilesIndex.topByVolume.some((p) => p.playerName === PLAYER_A)).toBe(true);
  });

  test("buildTennisHqPayload keeps unsynced events with null eventId", async () => {
    const db = seedFixtureDb();
    const payload = await buildTennisHqPayload({
      db,
      board: mockBoardUnsynced(),
    });

    expect(payload.liveBoard).toHaveLength(1);
    expect(payload.liveBoard[0]!.eventId).toBeNull();
    expect(payload.liveBoard[0]!.score).toBeNull();
    expect(payload.liveBoard[0]!.sides[0]!.profile).toBeNull();
    expect(payload.liveBoard[0]!.surfaceEdge).toBe(0);
    expect(payload.liveBoard[0]!.surfaceEdgeReliable).toBe(false);
    expect(payload.liveBoard[0]!.surfaceEdgeEvidence).toBe("missing-surface");
  });

  test("live-cache health overrides stale match counts while retaining snapshot durability", async () => {
    const db = seedFixtureDb();
    const nowMs = Date.now();
    const crossMarketOdds = new Map<string, CrossMarketOdds>([
      [
        EVENT_TICKER,
        {
          polymarketProb: 0.62,
          polymarketVolume24h: 20,
          polymarketVolumeLifetime: 100,
          polymarketLiquidity: 35,
          polymarketOpenInterest: 12,
          polymarketEventId: "poly-1",
          polymarketMatchMethod: "surname" as const,
          reconciliation: {
            sport: SPORT.tennis,
            eventType: "match" as const,
            participantFormat: "singles" as const,
            kalshiSeries: asSeriesTicker("KXITFMATCH"),
            polymarketObservedAtMs: nowMs,
            polymarketCacheState: "healthy" as const,
          },
          pinnacleProb: null,
        },
      ],
    ]);
    const payload = await buildTennisHqPayload({
      db,
      board: mockBoard(),
      nowMs,
      crossMarketOdds,
    });

    expect(payload.dataHealth.source).toBe("live-cache");
    expect(payload.dataHealth.matchedEvents).toBe(1);
    expect(payload.dataHealth.kalshiVolume24h).toBe(1900);
    expect(payload.dataHealth.polymarketVolume24h).toBe(20);
    expect(payload.dataHealth.kalshiVolumeLifetime).toBe(5000);

    crossMarketOdds.get(EVENT_TICKER)!.reconciliation!.polymarketCacheState = "circuit_open";
    const degraded = await buildTennisHqPayload({
      db,
      board: mockBoard(),
      nowMs,
      crossMarketOdds,
    });
    expect(degraded.dataHealth).toMatchObject({
      state: "degraded",
      matchedEvents: 1,
      staleQuoteEvents: 1,
    });
  });

  test("classifies venue health by coverage rate instead of an absolute match count", () => {
    expect(classifyTennisDataHealth(10_000, 50)).toBe("degraded");
    expect(classifyTennisDataHealth(49, 49)).toBe("healthy");
    expect(classifyTennisDataHealth(49, 49, 1)).toBe("degraded");
    expect(classifyTennisDataHealth(235, 0)).toBe("critical");
    expect(classifyTennisDataHealth(0, 0)).toBe("unavailable");
  });

  test("snapshot health requires exact lane and fresh venue provenance", () => {
    const db = seedFixtureDb();
    const nowMs = 1_000_000;
    db.run(
      `UPDATE price_snapshots
       SET kalshi_series = NULL,
           event_type = NULL,
           participant_format = NULL,
           poly_observed_at_ms = NULL,
           poly_cache_state = NULL`,
    );
    expect(loadTennisDataHealth(db, [EVENT_ID], nowMs)).toMatchObject({
      state: "critical",
      matchedEvents: 0,
      staleQuoteEvents: 0,
    });

    db.query(
      `UPDATE price_snapshots
       SET kalshi_series = 'KXITFMATCH',
           event_type = 'match',
           participant_format = 'singles',
           poly_observed_at_ms = $observed,
           poly_cache_state = 'circuit_open'`,
    ).run({ $observed: nowMs - 1_000 });
    expect(loadTennisDataHealth(db, [EVENT_ID], nowMs)).toMatchObject({
      state: "degraded",
      matchedEvents: 1,
      staleQuoteEvents: 1,
    });

    db.query(
      `UPDATE price_snapshots
       SET poly_observed_at_ms = $observed,
           poly_cache_state = 'healthy'`,
    ).run({ $observed: nowMs - 300_001 });
    expect(loadTennisDataHealth(db, [EVENT_ID], nowMs)).toMatchObject({
      state: "critical",
      matchedEvents: 0,
      staleQuoteEvents: 1,
    });

    db.close();
  });

  test("buildTennisHqPayload degrades when event store absent", async () => {
    const payload = await buildTennisHqPayload({
      dbPath: "/tmp/nonexistent-event-store-tennis-hq.db",
      board: mockBoard(),
    });

    expect(payload.sources.eventStore).toBe("absent");
    expect(payload.dataHealth.state).toBe("unavailable");
    expect(payload.liveBoard[0]!.eventId).toBeNull();
    expect(payload.profilesIndex.total).toBe(0);
  });

  test("rejects a table-tennis board at the Tennis HQ boundary", async () => {
    const board = mockBoard();
    board.series[0]!.events[0]!.sport = SPORT.tableTennis;
    await expect(buildTennisHqPayload({ board })).rejects.toThrow(
      "cannot ingest a non-tennis board",
    );
  });

  test("getPlayerDetail returns profile and recent events", () => {
    const db = seedFixtureDb();
    db.query(
      `UPDATE events SET winner = $winner, loser = $loser, outcome = 'completed'
       WHERE event_id = $event_id`,
    ).run({ $winner: PLAYER_A, $loser: PLAYER_B, $event_id: EVENT_ID });

    const result = getPlayerDetail(PLAYER_A, { db });

    expect(result.state).toBe("ok");
    if (result.state !== "ok") return;
    expect(result.profile.playerName).toBe(PLAYER_A);
    expect(result.profile.competitorIds).toContain(COMPETITOR_A);
    expect(result.profile.recentEvents.length).toBeGreaterThanOrEqual(1);
    const recent = result.profile.recentEvents[0]!;
    expect(recent.opponent).toBe(PLAYER_B);
    expect(recent.outcome).toBe("win");
    expect(recent.eventTicker).toBe(EVENT_TICKER);
    expect(recent.lastMidCents).toBe(46);
  });

  test("getPlayerDetail returns not_found for unknown player", () => {
    const db = seedFixtureDb();
    const result = getPlayerDetail("Nobody Here", { db });
    expect(result.state).toBe("not_found");
  });
});

describe("surface edge", () => {
  test("normalizes labels and dampens a reliable percentage-point difference", () => {
    expect(normalizeTennisSurface(" Hard ")).toBe("hard");
    expect(normalizeTennisSurface("unknown")).toBeNull();
    expect(
      computeSurfaceEdge(
        { appearances: 20, wins: 16, winRate: 0.8 },
        { appearances: 20, wins: 4, winRate: 0.2 },
      ),
    ).toBe(42);
    expect(
      computeSurfaceEdge(
        { appearances: 20, wins: 16, winRate: 0.8 },
        { appearances: 20, wins: 4, winRate: 0.2 },
        { scaling: "linear" },
      ),
    ).toBe(60);
    expect(
      computeSurfaceEdge(
        { appearances: 20, wins: 16, winRate: 0.8 },
        { appearances: 20, wins: 4, winRate: 0.2 },
        { scaling: "sigmoid" },
      ),
    ).toBe(91);
  });

  test("stays neutral below the minimum sample", () => {
    expect(
      computeSurfaceEdge(
        {
          appearances: MIN_SURFACE_EDGE_APPEARANCES - 1,
          wins: 8,
          winRate: 8 / 9,
        },
        { appearances: 20, wins: 4, winRate: 0.2 },
      ),
    ).toBe(0);
    expect(
      computeSurfaceEdge(
        { appearances: 9, wins: 8, winRate: 8 / 9 },
        { appearances: 20, wins: 4, winRate: 0.2 },
        { minSampleSize: 9, scaling: "linear" },
      ),
    ).toBe(69);
  });
});
