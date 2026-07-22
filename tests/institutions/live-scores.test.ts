// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../../src/research/paths.ts";
import { mintKalshiCompetitorEventId } from "../../src/institutions/event-store/kalshi-event-id.ts";
import {
  asCompetitorId,
  asKalshiEventTicker,
  asSeriesTicker,
} from "../../src/institutions/event-store/brands.ts";
import {
  analyzeScoreSnapshotCadence,
  classifyScoreTransition,
  clearStaleLiveFlags,
  evaluateLiveCanary,
  formatLiveScoreLine,
  getLiveScore,
  labelForCompetitor,
  listWatchEvents,
  LIVE_STALE_MS,
  missingLiveDataDetailKeys,
  pollLiveScores,
  type LivePollSummary,
} from "../../src/institutions/event-store/live-scores.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";

const FIXTURE = joinPath(import.meta.dir, "../fixtures/kalshi-live-data.json");

const competitor1Id = asCompetitorId("9eface64-a579-436d-8717-50f2730400e2");
const competitor2Id = asCompetitorId("2b652366-a7ff-4cc9-8ab9-8a0ba31b68ed");
const eventTicker = asKalshiEventTicker("KXITFWMATCH-26JUL22PENKUL");

function canarySummary(partial: Partial<LivePollSummary>): LivePollSummary {
  return {
    watched: 0,
    polled: 0,
    upserted: 0,
    snapshotsAppended: 0,
    live: 0,
    milestoneMissing: 0,
    wouldRetire: 0,
    errors: [],
    dryRun: true,
    rows: [],
    staleLiveCleared: 0,
    durationMs: 0,
    concurrency: 1,
    ...partial,
  };
}

describe("live-scores", () => {
  test("watch set uses lead window; poll upserts + snapshots on change", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const fx = await Bun.file(FIXTURE).json();
    const startTs = new Date(Date.now() + 2 * 60_000).toISOString(); // within 5m lead
    const eventId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs,
    });
    const now = Date.now();
    db.query(
      `INSERT INTO events (
        event_id, tour, level, tournament, location, surface, court, round, best_of,
        player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
        source_row_hash, ingested_at, corpus
      ) VALUES (
        $id, 'ITF-W', 'KXITFWMATCH', 'W35', '', 'Hard', '', 'R32', NULL,
        'Kulikova', 'Penickova', '', '', $start, 'scheduled', 'kalshi-api', '', $now,
        $hash, $now, 'trading'
      )`,
    ).run({ $id: eventId, $start: startTs, $now: now, $hash: `t|${eventTicker}` });
    db.query(
      `INSERT INTO markets (
        market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
        competitor_id, source, fetched_ts
      ) VALUES
        ('kalshi:${eventTicker}-PEN', $id, 'kalshi', '${eventTicker}-PEN', 'KXITFWMATCH', 'match_winner',
         'Penickova', 'PEN', $c1, 'kalshi-api', $now),
        ('kalshi:${eventTicker}-KUL', $id, 'kalshi', '${eventTicker}-KUL', 'KXITFWMATCH', 'match_winner',
         'Kulikova', 'KUL', $c2, 'kalshi-api', $now)`,
    ).run({ $id: eventId, $c1: competitor1Id, $c2: competitor2Id, $now: now });

    expect(listWatchEvents(db, { leadMinutes: 5 })).toHaveLength(1);

    let phase: "idle" | "live" = "idle";
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/milestones")) {
        return new Response(JSON.stringify(fx.milestones), { status: 200 });
      }
      if (url.includes("/live_data/")) {
        const body = phase === "idle" ? fx.live_data_not_started : fx.live_data_in_progress;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };

    const first = await pollLiveScores(db, {
      eventTickers: [eventTicker],
      fetchImpl,
      pauseMs: 0,
    });
    expect(first.upserted).toBe(1);
    expect(first.snapshotsAppended).toBe(1);
    expect(first.live).toBe(0);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]!.status).toBe("not_started");
    expect(first.rows[0]!.isLive).toBe(false);
    expect(first.rows[0]!.playerA).toBe("Kulikova"); // sorted store labels
    expect(first.rows[0]!.c1Label).toBe("Penickova"); // live_data c1 UUID
    expect(getLiveScore(db, eventId)?.isLive).toBe(false);

    phase = "live";
    const second = await pollLiveScores(db, {
      eventTickers: [eventTicker],
      fetchImpl,
      pauseMs: 0,
    });
    expect(second.live).toBe(1);
    expect(second.snapshotsAppended).toBe(1);
    expect(second.rows[0]!.isLive).toBe(true);
    expect(second.rows[0]!.pointsHome).toBe(30);
    expect(second.rows[0]!.gamesHome).toBe(2);
    expect(second.rows[0]!.serverSide).toBe(1);
    expect(second.rows[0]!.c1Label).toBe("Penickova");
    expect(second.rows[0]!.c2Label).toBe("Kulikova");
    // Matchup follows c1/c2 UUIDs, not localeCompare-sorted player_a/player_b.
    expect(formatLiveScoreLine(second.rows[0]!)).toContain("LIVE");
    expect(formatLiveScoreLine(second.rows[0]!)).toContain("Penickova vs Kulikova");
    expect(formatLiveScoreLine(second.rows[0]!)).not.toContain("Kulikova vs Penickova");
    const score = getLiveScore(db, eventId)!;
    expect(score.isLive).toBe(true);
    expect(score.pointsHome).toBe(30);
    expect(score.gamesHome).toBe(2);

    const snaps = db.query(`SELECT COUNT(*) AS n FROM score_snapshots`).get() as { n: number };
    expect(snaps.n).toBe(2);
  });

  test("dry-run fetches but writes nothing", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const fx = await Bun.file(FIXTURE).json();
    const startTs = new Date(Date.now() + 2 * 60_000).toISOString();
    const eventId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs,
    });
    const now = Date.now();
    db.query(
      `INSERT INTO events (
        event_id, tour, level, tournament, location, surface, court, round, best_of,
        player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
        source_row_hash, ingested_at, corpus
      ) VALUES (
        $id, 'ITF-W', 'KXITFWMATCH', 'W35', '', 'Hard', '', 'R32', NULL,
        'Penickova', 'Kulikova', '', '', $start, 'scheduled', 'kalshi-api', '', $now,
        $hash, $now, 'trading'
      )`,
    ).run({ $id: eventId, $start: startTs, $now: now, $hash: `t|dry|${eventTicker}` });
    db.query(
      `INSERT INTO markets (
        market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
        competitor_id, source, fetched_ts
      ) VALUES
        ('kalshi:${eventTicker}-PEN', $id, 'kalshi', '${eventTicker}-PEN', 'KXITFWMATCH', 'match_winner',
         'Penickova', 'PEN', $c1, 'kalshi-api', $now),
        ('kalshi:${eventTicker}-KUL', $id, 'kalshi', '${eventTicker}-KUL', 'KXITFWMATCH', 'match_winner',
         'Kulikova', 'KUL', $c2, 'kalshi-api', $now)`,
    ).run({ $id: eventId, $c1: competitor1Id, $c2: competitor2Id, $now: now });

    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/milestones")) {
        return new Response(JSON.stringify(fx.milestones), { status: 200 });
      }
      return new Response(JSON.stringify(fx.live_data_in_progress), { status: 200 });
    };

    const summary = await pollLiveScores(db, {
      eventTickers: [eventTicker],
      fetchImpl,
      pauseMs: 0,
      dryRun: true,
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.polled).toBe(1);
    expect(summary.upserted).toBe(1);
    expect(summary.live).toBe(1);
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]!.isLive).toBe(true);
    expect(summary.rows[0]!.pointsHome).toBe(30);
    expect(summary.rows[0]!.upserted).toBe(true);
    expect(getLiveScore(db, eventId)).toBeNull();
    const n = db.query(`SELECT COUNT(*) AS n FROM score_snapshots`).get() as { n: number };
    expect(n.n).toBe(0);
  });

  /**
   * Dry-run must pin the write boundary the same way as a migration pins schema:
   * same DB state + same wire → would_upsert / would_snapshots === real writes.
   * If they diverge, the canary is lying.
   */
  test("dry-run would_* matches real writer against same DB state", async () => {
    const fx = await Bun.file(FIXTURE).json();
    const startTs = new Date(Date.now() + 2 * 60_000).toISOString();
    const now = Date.now();
    const eventId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs,
    });

    const seed = (db: ReturnType<typeof openEventStore>) => {
      db.query(
        `INSERT INTO events (
          event_id, tour, level, tournament, location, surface, court, round, best_of,
          player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
          source_row_hash, ingested_at, corpus
        ) VALUES (
          $id, 'ITF-W', 'KXITFWMATCH', 'W35', '', 'Hard', '', 'R32', NULL,
          'Penickova', 'Kulikova', '', '', $start, 'scheduled', 'kalshi-api', '', $now,
          $hash, $now, 'trading'
        )`,
      ).run({ $id: eventId, $start: startTs, $now: now, $hash: `eq|${eventTicker}` });
      db.query(
        `INSERT INTO markets (
          market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
          competitor_id, source, fetched_ts
        ) VALUES
          ('kalshi:${eventTicker}-PEN', $id, 'kalshi', '${eventTicker}-PEN', 'KXITFWMATCH', 'match_winner',
           'Penickova', 'PEN', $c1, 'kalshi-api', $now),
          ('kalshi:${eventTicker}-KUL', $id, 'kalshi', '${eventTicker}-KUL', 'KXITFWMATCH', 'match_winner',
           'Kulikova', 'KUL', $c2, 'kalshi-api', $now)`,
      ).run({ $id: eventId, $c1: competitor1Id, $c2: competitor2Id, $now: now });
    };

    let phase: "idle" | "live" = "idle";
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/milestones")) {
        return new Response(JSON.stringify(fx.milestones), { status: 200 });
      }
      const body = phase === "idle" ? fx.live_data_not_started : fx.live_data_in_progress;
      return new Response(JSON.stringify(body), { status: 200 });
    };

    const opts = { eventTickers: [eventTicker], fetchImpl, pauseMs: 0 as const };

    // Parallel DBs, empty live_scores — first poll (idle).
    const dryDb = openEventStore({ dbPath: ":memory:" });
    const writeDb = openEventStore({ dbPath: ":memory:" });
    seed(dryDb);
    seed(writeDb);

    phase = "idle";
    const dry1 = await pollLiveScores(dryDb, { ...opts, dryRun: true });
    const write1 = await pollLiveScores(writeDb, opts);
    expect(dry1.upserted).toBe(write1.upserted);
    expect(dry1.snapshotsAppended).toBe(write1.snapshotsAppended);
    expect(dry1.live).toBe(write1.live);
    expect(dry1.upserted).toBe(1);
    expect(dry1.snapshotsAppended).toBe(1); // first-seen
    expect(getLiveScore(dryDb, eventId)).toBeNull();
    expect(getLiveScore(writeDb, eventId)).not.toBeNull();

    // Same DB state: dry-run then real re-poll (unchanged idle) → snapshot 0 both ways.
    const dry2 = await pollLiveScores(writeDb, { ...opts, dryRun: true });
    const write2 = await pollLiveScores(writeDb, opts);
    expect(dry2.upserted).toBe(write2.upserted);
    expect(dry2.snapshotsAppended).toBe(write2.snapshotsAppended);
    expect(dry2.snapshotsAppended).toBe(0);
    expect(dry2.upserted).toBe(1);

    // Score change: both plan one snapshot.
    phase = "live";
    const dry3 = await pollLiveScores(writeDb, { ...opts, dryRun: true });
    const write3 = await pollLiveScores(writeDb, opts);
    expect(dry3.upserted).toBe(write3.upserted);
    expect(dry3.snapshotsAppended).toBe(write3.snapshotsAppended);
    expect(dry3.live).toBe(write3.live);
    expect(dry3.snapshotsAppended).toBe(1);
    expect(dry3.live).toBe(1);

    const snaps = writeDb.query(`SELECT COUNT(*) AS n FROM score_snapshots`).get() as { n: number };
    // idle first write + live change (unchanged re-polls added 0)
    expect(snaps.n).toBe(2);
  });

  test("evaluateLiveCanary fails loud on dead fetch / all milestones missing", () => {
    expect(evaluateLiveCanary(canarySummary({ watched: 3, polled: 0 })).ok).toBe(false);
    expect(
      evaluateLiveCanary(canarySummary({ watched: 2, polled: 0, milestoneMissing: 2 })).exitCode,
    ).toBe(2);
    expect(
      evaluateLiveCanary(
        canarySummary({
          watched: 5,
          polled: 5,
          upserted: 5,
          snapshotsAppended: 2,
          live: 2,
        }),
      ).ok,
    ).toBe(true);
    expect(
      evaluateLiveCanary(
        canarySummary({ watched: 1, polled: 1, upserted: 0, live: 1 }),
      ).reasons[0],
    ).toContain("would_upsert");
  });

  test("classifyScoreTransition prefers coarsest structural change", () => {
    const base = {
      status: "in_progress",
      setsHome: 0,
      setsAway: 0,
      gamesHome: 2,
      gamesAway: 1,
      pointsHome: 30,
      pointsAway: 15,
      serverCompetitorId: competitor1Id,
    };
    expect(classifyScoreTransition(null, base)).toBe("first");
    expect(classifyScoreTransition(base, { ...base, pointsHome: 40 })).toBe("point");
    expect(classifyScoreTransition(base, { ...base, gamesHome: 3, pointsHome: 0 })).toBe("game");
    expect(
      classifyScoreTransition(base, {
        ...base,
        setsHome: 1,
        gamesHome: 0,
        gamesAway: 0,
        pointsHome: 0,
        pointsAway: 0,
      }),
    ).toBe("set");
    expect(classifyScoreTransition(base, base)).toBe("none");
  });

  test("missingLiveDataDetailKeys detects wire shape drift", () => {
    expect(missingLiveDataDetailKeys({ status: "in_progress" })).toContain("competitor1_id");
    expect(
      missingLiveDataDetailKeys({
        competitor1_id: "a",
        competitor2_id: "b",
        competitor1_overall_score: 0,
        competitor2_overall_score: 0,
        competitor1_current_round_score: 0,
        competitor2_current_round_score: 0,
        competitor1_round_scores: [],
        competitor2_round_scores: [],
        completed_rounds: 0,
        status: "in_progress",
        match_status: "in_play",
        server: "",
      }),
    ).toEqual([]);
  });

  test("analyzeScoreSnapshotCadence reports gaps and REST verdict", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const eventId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs: new Date().toISOString(),
    });
    const now = Date.now();
    db.query(
      `INSERT INTO events (
        event_id, tour, level, tournament, location, surface, court, round, best_of,
        player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
        source_row_hash, ingested_at, corpus
      ) VALUES (
        $id, 'ITF-W', 'KXITFWMATCH', 'W', '', 'H', '', 'R', NULL,
        'A', 'B', '', '', $start, 'scheduled', 'kalshi-api', '', $now, $hash, $now, 'trading'
      )`,
    ).run({
      $id: eventId,
      $start: new Date().toISOString(),
      $now: now,
      $hash: "cadence|t",
    });
    // Snapshots every 40s with interval assumption 10s → rest miss
    const scores = [
      { t: now - 120_000, g: 0, p: 0 },
      { t: now - 80_000, g: 0, p: 15 },
      { t: now - 40_000, g: 0, p: 30 },
      { t: now, g: 1, p: 0 },
    ];
    for (const s of scores) {
      db.query(
        `INSERT INTO score_snapshots (
           event_id, event_ticker, milestone_id, ts, source_clock, status,
           sets_home, sets_away, games_home, games_away, points_home, points_away,
           server_competitor_id, details_json, source, source_url, fetched_ts
         ) VALUES (
           $id, $ticker, 'm', $ts, 'recv', 'in_progress',
           0, 0, $g, 0, $p, 0, NULL, '{}', 'kalshi-live-data', '', $ts
         )`,
      ).run({ $id: eventId, $ticker: eventTicker, $ts: s.t, $g: s.g, $p: s.p });
    }
    const report = analyzeScoreSnapshotCadence(db, { intervalMs: 10_000 });
    expect(report.totals.snapshots).toBe(4);
    expect(report.events[0]!.restVerdict).toBe("miss");
    expect(report.totals.pointTransitions).toBeGreaterThanOrEqual(1);
    expect(report.totals.gameTransitions).toBeGreaterThanOrEqual(1);
  });

  test("labelForCompetitor maps UUID to market label", () => {
    expect(
      labelForCompetitor(
        [
          { competitorId: competitor1Id, label: "Penickova" },
          { competitorId: competitor2Id, label: "Kulikova" },
        ],
        competitor1Id,
      ),
    ).toBe("Penickova");
  });

  test("clearStaleLiveFlags drops stuck is_live from watch membership", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    const startTs = new Date(now + 60 * 60_000).toISOString(); // outside lead unless is_live
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
    ).run({ $id: eventId, $start: startTs, $now: now, $hash: "stale-live" });
    db.query(
      `INSERT INTO markets (
        market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
        competitor_id, source, fetched_ts
      ) VALUES ('kalshi:${eventTicker}-PEN', $id, 'kalshi', '${eventTicker}-PEN', 'KXITFWMATCH',
        'match_winner', 'Penickova', 'PEN', $c1, 'kalshi-api', $now)`,
    ).run({ $id: eventId, $c1: competitor1Id, $now: now });
    db.query(
      `INSERT INTO live_scores (
         event_id, event_ticker, milestone_id, updated_ts, source_clock, status, match_status,
         sets_home, sets_away, games_home, games_away, points_home, points_away,
         server_competitor_id, competitor1_id, competitor2_id, is_live, details_json,
         source, source_url, fetched_ts
       ) VALUES (
         $id, $et, 'm1', $old, 'recv', 'in_progress', 'in_progress',
         0, 0, 1, 0, 30, 0, NULL, $c1, $c2, 1, '{}',
         'kalshi-live-data', '', $old
       )`,
    ).run({
      $id: eventId,
      $et: eventTicker,
      $old: now - LIVE_STALE_MS - 1_000,
      $c1: competitor1Id,
      $c2: competitor2Id,
    });
    expect(listWatchEvents(db, { leadMinutes: 5, nowMs: now }).map((w) => w.eventId)).toEqual([]);
    expect(clearStaleLiveFlags(db, { nowMs: now })).toBe(0); // already cleared by listWatchEvents
    const live = db
      .query(`SELECT is_live FROM live_scores WHERE event_id = $id`)
      .get({ $id: eventId }) as { is_live: number };
    expect(live.is_live).toBe(0);
  });

  test("watch set drops ancient scheduled stubs so they cannot starve LIMIT", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    const ancientTs = new Date(now - 48 * 3600_000).toISOString();
    const nearTs = new Date(now + 2 * 60_000).toISOString();
    const ancientId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: asCompetitorId("cccccccc-cccc-cccc-cccc-cccccccccccc"),
      competitorB: asCompetitorId("dddddddd-dddd-dddd-dddd-dddddddddddd"),
      startTs: ancientTs,
    });
    const nearId = mintKalshiCompetitorEventId({
      series: asSeriesTicker("KXITFWMATCH"),
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs: nearTs,
    });
    for (const [id, start, ticker] of [
      [ancientId, ancientTs, "KXITFWMATCH-20JUL20AAAABB"] as const,
      [nearId, nearTs, "KXITFWMATCH-26JUL22PENKUL"] as const,
    ]) {
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
      ).run({ $id: id, $start: start, $now: now, $hash: `starve|${ticker}` });
      db.query(
        `INSERT INTO markets (
          market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
          competitor_id, source, fetched_ts
        ) VALUES ('kalshi:${ticker}-A', $id, 'kalshi', '${ticker}-A', 'KXITFWMATCH',
          'match_winner', 'A', 'A', NULL, 'kalshi-api', $now)`,
      ).run({ $id: id, $now: now });
    }
    const watch = listWatchEvents(db, { leadMinutes: 5, limit: 40 });
    expect(watch.map((w) => w.eventId)).toEqual([nearId]);
  });
});
