// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../../src/research/paths.ts";
import { ingestPrimaryResultMatches } from "../../src/institutions/event-store/ingest-primary-results.ts";
import {
  itfStadionDayUrl,
  parseItfStadionDayWire,
} from "../../src/institutions/event-store/itf-stadion.ts";
import { mintKalshiCompetitorEventId } from "../../src/institutions/event-store/kalshi-event-id.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  bridgeStadionToKalshi,
  buildMatchKey,
  extractLastName,
  getLinkedKalshiEventId,
  lanesForStadionTour,
  matchDayCandidates,
  normalizeLastName,
  outcomeBitForKalshiPlayers,
} from "../../src/institutions/event-store/stadion-kalshi-bridge.ts";
import { asCanonicalEventId } from "../../src/institutions/event-store/types.ts";

const FIXTURE = joinPath(import.meta.dir, "../fixtures/itf-stadion-day.json");

function seedKalshiEvent(
  db: ReturnType<typeof openEventStore>,
  opts: {
    eventId: string;
    playerA: string;
    playerB: string;
    startTs: string;
    series: string;
    eventTicker: string;
  },
): void {
  const now = Date.now();
  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus
    ) VALUES (
      $event_id, 'ITF-W', $series, 'test', '', 'Clay', '', 'unknown', NULL,
      $player_a, $player_b, '', '', $start_ts, 'scheduled', 'kalshi-api', '', $now,
      $hash, $now, 'trading'
    )`,
  ).run({
    $event_id: opts.eventId,
    $series: opts.series,
    $player_a: opts.playerA,
    $player_b: opts.playerB,
    $start_ts: opts.startTs,
    $now: now,
    $hash: `kalshi-test|${opts.eventTicker}`,
  });
  db.query(
    `INSERT INTO markets (
      market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
      competitor_id, source, fetched_ts
    ) VALUES (
      $mid, $eid, 'kalshi', $ticker, $series, 'match_winner', $label, 'X',
      NULL, 'kalshi-api', $now
    )`,
  ).run({
    $mid: `kalshi:${opts.eventTicker}-A`,
    $eid: opts.eventId,
    $ticker: `${opts.eventTicker}-A`,
    $series: opts.series,
    $label: opts.playerA,
    $now: now,
  });
}

describe("stadion-kalshi-bridge helpers", () => {
  test("normalize + extract last names", () => {
    expect(extractLastName("Julia Grabher")).toBe("grabher");
    expect(extractLastName("S. Bejlek")).toBe("bejlek");
    expect(normalizeLastName("Šobolieva")).toBe("sobolieva");
  });

  test("women lane mapping (not /men/ in women)", () => {
    expect(lanesForStadionTour("ITF-W", "singles")).toEqual(["KXITFWMATCH"]);
    expect(lanesForStadionTour("ITF-M", "singles")).toEqual(["KXITFMATCH"]);
  });

  test("lane fallback when stored tour conflicts with level", () => {
    // Poisoned ITF-M + women's level → prefer W lane, still probe M.
    expect(
      lanesForStadionTour("ITF-M", "singles", "itf pro wtt - women's 15"),
    ).toEqual(["KXITFWMATCH", "KXITFMATCH"]);
    expect(
      lanesForStadionTour("ITF-W", "singles", "itf pro wtt - men's 15"),
    ).toEqual(["KXITFMATCH", "KXITFWMATCH"]);
    // Matching tour+level stays single-lane.
    expect(
      lanesForStadionTour("ITF-W", "singles", "itf pro wtt - women's 15"),
    ).toEqual(["KXITFWMATCH"]);
  });

  test("match key is order-independent on surnames", () => {
    const a = buildMatchKey({
      day: "2026-07-21",
      lane: "KXITFWMATCH",
      playerA: "Julia Grabher",
      playerB: "Ekaterina Perelygina",
      format: "singles",
    });
    const b = buildMatchKey({
      day: "2026-07-21",
      lane: "KXITFWMATCH",
      playerA: "Ekaterina Perelygina",
      playerB: "Julia Grabher",
      format: "singles",
    });
    expect(a).toBe(b);
    expect(a).toBe("2026-07-21|KXITFWMATCH|grabher|perelygina");
  });

  test("identical surnames refuse key", () => {
    expect(
      buildMatchKey({
        day: "2026-07-21",
        lane: "KXITFMATCH",
        playerA: "John Smith",
        playerB: "Jane Smith",
        format: "singles",
      }),
    ).toBeNull();
  });

  test("matchDayCandidates includes ±1 UTC day", () => {
    expect(matchDayCandidates("2026-07-21T12:00:00.000Z")).toEqual([
      "2026-07-21",
      "2026-07-20",
      "2026-07-22",
    ]);
  });

  test("bridge links when Kalshi occurrence is ±1 day from Stadion pad", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const wire = await Bun.file(FIXTURE).json();
    const matches = parseItfStadionDayWire(wire, {
      sourceUrl: itfStadionDayUrl("2026-07-21"),
      fetchedTs: 1,
    });
    const target = matches.find((m) => m.format === "singles" && m.tour === "ITF-W");
    expect(target).toBeTruthy();
    ingestPrimaryResultMatches(db, [target!], { format: "singles" });

    // Stadion day from start_ts prefix; Kalshi occurrence shifted +1 calendar day.
    const kalshiStart = `${matchDayCandidates(target!.startTs)[2]}T18:00:00.000Z`;
    const kalshiId = mintKalshiCompetitorEventId({
      series: "KXITFWMATCH",
      competitorA: "day-a",
      competitorB: "day-b",
      startTs: kalshiStart,
    });
    seedKalshiEvent(db, {
      eventId: kalshiId,
      playerA: target!.playerA,
      playerB: target!.playerB,
      startTs: kalshiStart,
      series: "KXITFWMATCH",
      eventTicker: "KXITFWMATCH-26JUL22DAYSLK",
    });
    const summary = bridgeStadionToKalshi(db);
    expect(summary.linked).toBe(1);
    expect(getLinkedKalshiEventId(db, target!.eventId)).toBe(kalshiId);
  });

  test("outcome bit remaps when Kalshi player order differs", () => {
    expect(outcomeBitForKalshiPlayers("Julia Grabher", "Ekaterina Perelygina", "Julia Grabher")).toBe(
      0,
    );
    expect(outcomeBitForKalshiPlayers("Julia Grabher", "Julia Grabher", "Ekaterina Perelygina")).toBe(
      1,
    );
  });
});

describe("stadion-kalshi-bridge integrate", () => {
  test("links unique surname+day+lane and propagates resolution", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const wire = await Bun.file(FIXTURE).json();
    const matches = parseItfStadionDayWire(wire, {
      sourceUrl: itfStadionDayUrl("2026-07-21"),
      fetchedTs: 1,
    });
    const singles = matches.filter((m) => m.format === "singles");
    expect(singles.some((m) => m.tour === "ITF-W")).toBe(true);
    ingestPrimaryResultMatches(db, singles, { format: "singles" });

    const target = singles.find(
      (m) =>
        extractLastName(m.playerA) === "grabher" || extractLastName(m.playerB) === "grabher",
    );
    expect(target).toBeTruthy();

    const kalshiId = mintKalshiCompetitorEventId({
      series: "KXITFWMATCH",
      competitorA: "comp-grabher",
      competitorB: "comp-perelygina",
      startTs: target!.startTs,
    });
    // Reverse Kalshi label order vs Stadion sorted pair — tests outcome remap.
    seedKalshiEvent(db, {
      eventId: kalshiId,
      playerA: target!.playerB,
      playerB: target!.playerA,
      startTs: target!.startTs,
      series: "KXITFWMATCH",
      eventTicker: "KXITFWMATCH-26JUL21GRAPER",
    });

    const summary = bridgeStadionToKalshi(db);
    expect(summary.linked).toBeGreaterThanOrEqual(1);
    expect(getLinkedKalshiEventId(db, target!.eventId)).toBe(kalshiId);

    const res = db
      .query(`SELECT outcome, winner FROM resolutions WHERE event_id = $id`)
      .get({ $id: kalshiId }) as { outcome: number; winner: string };
    expect(res.winner).toBe(target!.winner);
    expect(res.outcome).toBe(
      outcomeBitForKalshiPlayers(target!.winner, target!.playerB, target!.playerA),
    );
  });

  test("adjacent-day Stadion twins refuse ±1 unique false link", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const playerA = "Ada Foo";
    const playerB = "Bea Bar";
    const day1 = "2026-07-21T12:00:00.000Z";
    const day2 = "2026-07-22T12:00:00.000Z";
    const now = Date.now();
    for (const [id, start] of [
      ["stadion|day1", day1],
      ["stadion|day2", day2],
    ] as const) {
      db.query(
        `INSERT INTO events (
          event_id, tour, level, tournament, location, surface, court, round, best_of,
          player_a, player_b, winner, loser, start_ts, outcome, score_text, source, source_url, fetched_ts,
          source_row_hash, ingested_at, corpus
        ) VALUES (
          $id, 'ITF-W', 'itf pro wtt - women''s 15', 'W15', '', 'Clay', '', 'R32', NULL,
          $a, $b, $a, $b, $start, 'completed', '6-1 6-1', 'itf-stadion', '', $now,
          $hash, $now, 'trading'
        )`,
      ).run({
        $id: id,
        $a: playerA,
        $b: playerB,
        $start: start,
        $now: now,
        $hash: `stadion-test|${id}`,
      });
      db.query(
        `INSERT INTO resolutions (
          event_id, outcome, winner, source, source_url, fetched_ts, corpus, resolved_ts
        ) VALUES ($id, 0, $a, 'itf-stadion', '', $now, 'trading', $start)`,
      ).run({ $id: id, $a: playerA, $now: now, $start: start });
    }
    // Only one Kalshi on day2 — day1 Stadion would uniquely ±1-link without the cross-day guard.
    const kalshiId = mintKalshiCompetitorEventId({
      series: "KXITFWMATCH",
      competitorA: "adj-a",
      competitorB: "adj-b",
      startTs: day2,
    });
    seedKalshiEvent(db, {
      eventId: kalshiId,
      playerA,
      playerB,
      startTs: day2,
      series: "KXITFWMATCH",
      eventTicker: "KXITFWMATCH-26JUL22FOOBAR",
    });
    const summary = bridgeStadionToKalshi(db);
    expect(getLinkedKalshiEventId(db, asCanonicalEventId("stadion|day2"))).toBe(kalshiId);
    expect(getLinkedKalshiEventId(db, asCanonicalEventId("stadion|day1"))).toBeUndefined();
    const day1Link = db
      .query(`SELECT status, detail FROM event_links WHERE stadion_event_id = 'stadion|day1'`)
      .get() as { status: string; detail: string };
    expect(day1Link.status).toBe("ambiguous");
    expect(day1Link.detail).toContain("cross_day_stadion_requires_primary");
    expect(summary.linked).toBe(1);
    expect(summary.ambiguous).toBe(1);
  });

  test("bridged resolution upserts when Kalshi row already exists", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const wire = await Bun.file(FIXTURE).json();
    const matches = parseItfStadionDayWire(wire, {
      sourceUrl: itfStadionDayUrl("2026-07-21"),
      fetchedTs: 1,
    });
    const target = matches.find(
      (m) =>
        m.format === "singles" &&
        (extractLastName(m.playerA) === "grabher" || extractLastName(m.playerB) === "grabher"),
    );
    expect(target).toBeTruthy();
    ingestPrimaryResultMatches(db, [target!], { format: "singles" });
    const kalshiId = mintKalshiCompetitorEventId({
      series: "KXITFWMATCH",
      competitorA: "comp-grabher-2",
      competitorB: "comp-perelygina-2",
      startTs: target!.startTs,
    });
    seedKalshiEvent(db, {
      eventId: kalshiId,
      playerA: target!.playerA,
      playerB: target!.playerB,
      startTs: target!.startTs,
      series: "KXITFWMATCH",
      eventTicker: "KXITFWMATCH-26JUL21GRAPER2",
    });
    db.query(
      `INSERT INTO resolutions (
         event_id, outcome, winner, source, source_url, fetched_ts, corpus, resolved_ts
       ) VALUES ($id, 1, 'stale', 'old', '', 1, 'trading', $ts)`,
    ).run({ $id: kalshiId, $ts: target!.startTs });

    const summary = bridgeStadionToKalshi(db);
    expect(summary.linked).toBeGreaterThanOrEqual(1);
    expect(summary.resolutionsPropagated).toBeGreaterThanOrEqual(1);
    const res = db
      .query(`SELECT outcome, winner FROM resolutions WHERE event_id = $id`)
      .get({ $id: kalshiId }) as { outcome: number; winner: string };
    expect(res.winner).toBe(target!.winner);
    expect(res.winner).not.toBe("stale");
  });

  test("hard-fails ambiguous when two Kalshi events share match key", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const wire = await Bun.file(FIXTURE).json();
    const matches = parseItfStadionDayWire(wire, {
      sourceUrl: itfStadionDayUrl("2026-07-21"),
      fetchedTs: 1,
    });
    const target = matches.find((m) => m.format === "singles" && m.tour === "ITF-W");
    expect(target).toBeTruthy();
    ingestPrimaryResultMatches(db, [target!], { format: "singles" });

    const a = mintKalshiCompetitorEventId({
      series: "KXITFWMATCH",
      competitorA: "a1",
      competitorB: "b1",
      startTs: target!.startTs,
    });
    const b = mintKalshiCompetitorEventId({
      series: "KXITFWMATCH",
      competitorA: "a2",
      competitorB: "b2",
      startTs: target!.startTs,
    });
    seedKalshiEvent(db, {
      eventId: a,
      playerA: target!.playerA,
      playerB: target!.playerB,
      startTs: target!.startTs,
      series: "KXITFWMATCH",
      eventTicker: "KXITFWMATCH-26JUL21AAA",
    });
    seedKalshiEvent(db, {
      eventId: b,
      playerA: target!.playerA,
      playerB: target!.playerB,
      startTs: target!.startTs,
      series: "KXITFWMATCH",
      eventTicker: "KXITFWMATCH-26JUL21BBB",
    });

    const summary = bridgeStadionToKalshi(db);
    expect(summary.ambiguous).toBe(1);
    expect(summary.linked).toBe(0);
    expect(getLinkedKalshiEventId(db, target!.eventId)).toBeUndefined();
    const link = db
      .query(`SELECT status, kalshi_event_id FROM event_links WHERE stadion_event_id = $id`)
      .get({ $id: target!.eventId }) as { status: string; kalshi_event_id: string | null };
    expect(link.status).toBe("ambiguous");
    expect(link.kalshi_event_id).toBeNull();
  });

  test("poisoned tour=ITF-M + women's level links to KXITFWMATCH when unique", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const wire = await Bun.file(FIXTURE).json();
    const matches = parseItfStadionDayWire(wire, {
      sourceUrl: itfStadionDayUrl("2026-07-21"),
      fetchedTs: 1,
    });
    const target = matches.find((m) => m.format === "singles" && m.tour === "ITF-W");
    expect(target).toBeTruthy();
    ingestPrimaryResultMatches(db, [target!], { format: "singles" });
    // Simulate old /men/-in-women bug: stored tour wrong, level still women's.
    db.query(
      `UPDATE events SET tour = 'ITF-M', level = $level WHERE event_id = $id`,
    ).run({
      $id: target!.eventId,
      $level: "itf pro wtt - women's 15",
    });

    const kalshiId = mintKalshiCompetitorEventId({
      series: "KXITFWMATCH",
      competitorA: "poison-a",
      competitorB: "poison-b",
      startTs: target!.startTs,
    });
    seedKalshiEvent(db, {
      eventId: kalshiId,
      playerA: target!.playerA,
      playerB: target!.playerB,
      startTs: target!.startTs,
      series: "KXITFWMATCH",
      eventTicker: "KXITFWMATCH-26JUL21POISON",
    });

    const summary = bridgeStadionToKalshi(db);
    expect(summary.linked).toBe(1);
    expect(summary.ambiguous).toBe(0);
    expect(getLinkedKalshiEventId(db, target!.eventId)).toBe(kalshiId);
  });

  test("bridge-after-sync smoke: Kalshi upsert then bridge refreshes event_links", async () => {
    // Mirrors tennis:itf --sync / tennis:record --sync finish: Stadion already in DB,
    // Kalshi sync lands competitor-keyed events, then bridgeStadionToKalshi runs.
    const db = openEventStore({ dbPath: ":memory:" });
    const wire = await Bun.file(FIXTURE).json();
    const matches = parseItfStadionDayWire(wire, {
      sourceUrl: itfStadionDayUrl("2026-07-21"),
      fetchedTs: 1,
    });
    const target = matches.find((m) => m.format === "singles" && m.tour === "ITF-W");
    expect(target).toBeTruthy();
    ingestPrimaryResultMatches(db, [target!], { format: "singles" });

    const before = bridgeStadionToKalshi(db);
    expect(before.linked).toBe(0);
    expect(before.unmatched).toBeGreaterThanOrEqual(1);
    expect(getLinkedKalshiEventId(db, target!.eventId)).toBeUndefined();

    const kalshiId = mintKalshiCompetitorEventId({
      series: "KXITFWMATCH",
      competitorA: "sync-a",
      competitorB: "sync-b",
      startTs: target!.startTs,
    });
    seedKalshiEvent(db, {
      eventId: kalshiId,
      playerA: target!.playerA,
      playerB: target!.playerB,
      startTs: target!.startTs,
      series: "KXITFWMATCH",
      eventTicker: "KXITFWMATCH-26JUL21SYNC",
    });

    const after = bridgeStadionToKalshi(db);
    expect(after.linked).toBe(1);
    expect(getLinkedKalshiEventId(db, target!.eventId)).toBe(kalshiId);
  });
});
