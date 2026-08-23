import { describe, expect, test } from "bun:test";
import { makeEventStoreDb } from "../../lib/fixtures/event-store.ts";
import {
  latestOddsByMatchKey,
  latestOddsForEvent,
  loadPricedBookEvents,
  matchKeyForEventId,
  persistOddsTicks,
} from "../../../src/institutions/event-store/odds-ticks-store.ts";

function makeDb(): ReturnType<typeof makeEventStoreDb> {
  return makeEventStoreDb();
}

describe("odds-ticks store (live-odds persistence contract)", () => {
  test("latestOddsForEvent returns the newest tick per side", () => {
    const db = makeDb();
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1','home',1.50,100)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1','home',1.60,200)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1','away',2.90,200)");
    const odds = latestOddsForEvent(db, "e1");
    expect(odds.home).toEqual({ decimal: 1.6, ts: 200 });
    expect(odds.away).toEqual({ decimal: 2.9, ts: 200 });
  });

  test("unknown sides are ignored; missing side is null", () => {
    const db = makeDb();
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e2','winner',1.50,100)");
    const odds = latestOddsForEvent(db, "e2");
    expect(odds.home).toBeNull();
    expect(odds.away).toBeNull();
  });

  test("persistOddsTicks inserts and dedupes on (event_id, source, side, ts)", () => {
    const db = makeDb();
    const n1 = persistOddsTicks(db, [
      { eventId: "e1", source: "src", side: "home", decimalOdds: 1.55, ts: 100 },
      { eventId: "e1", source: "src", side: "away", decimalOdds: 2.60, ts: 100 },
    ]);
    expect(n1).toBe(2);
    const n2 = persistOddsTicks(db, [
      { eventId: "e1", source: "src", side: "home", decimalOdds: 1.55, ts: 100 }, // dup
      { eventId: "e1", source: "src", side: "home", decimalOdds: 1.50, ts: 200 }, // new ts
    ]);
    expect(n2).toBe(1);
    const odds = latestOddsForEvent(db, "e1");
    expect(odds.home).toEqual({ decimal: 1.5, ts: 200 });
    expect(odds.away).toEqual({ decimal: 2.6, ts: 100 });
  });

  test("persistOddsTicks skips unusable odds", () => {
    const db = makeDb();
    const n = persistOddsTicks(db, [
      { eventId: "e1", source: "src", side: "home", decimalOdds: 0.9, ts: 1 }, // <= 1
      { eventId: "e1", source: "src", side: "away", decimalOdds: 2.0, ts: 1 },
    ]);
    expect(n).toBe(1);
  });

  test("latestOddsForEvent resolves winner/loser via the events registry", () => {
    const db = makeDb();
    db.run("INSERT INTO events (event_id, player_a, player_b, winner, loser) VALUES ('e1', 'Ann Pace', 'Bob Trevisan', 'Ann Pace', 'Bob Trevisan')");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1', 'winner', 1.4, 100)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1', 'loser', 3.1, 100)");
    const odds = latestOddsForEvent(db, "e1");
    expect(odds.home).toEqual({ decimal: 1.4, ts: 100 });
    expect(odds.away).toEqual({ decimal: 3.1, ts: 100 });
  });

  test("matchKeyForEventId reads the backfilled column or event_links", () => {
    const db = makeDb();
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts, match_key) VALUES ('e1', 'home', 1.5, 1, 'mk-1')");
    expect(matchKeyForEventId(db, "e1")).toBe("mk-1");
    db.run("INSERT INTO event_links (stadion_event_id, kalshi_event_id, match_key) VALUES ('e2', 'k2', 'mk-2')");
    expect(matchKeyForEventId(db, "e2")).toBe("mk-2");
    expect(matchKeyForEventId(db, "unknown")).toBeNull();
  });

  test("latestOddsByMatchKey resolves winner/loser through events names", () => {
    const db = makeDb();
    db.run("INSERT INTO events (event_id, player_a, player_b, winner, loser) VALUES ('e1', 'Ann Pace', 'Bob Trevisan', 'Bob Trevisan', 'Ann Pace')");
    db.run("INSERT INTO event_links (stadion_event_id, kalshi_event_id, match_key) VALUES ('e1', 'k1', 'mk-1')");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1', 'winner', 2.2, 1)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1', 'loser', 1.6, 1)");
    const odds = latestOddsByMatchKey(db, "mk-1");
    // winner = Bob Trevisan = away → away side; loser = Ann Pace = home.
    expect(odds.home).toEqual({ decimal: 1.6, ts: 1 });
    expect(odds.away).toEqual({ decimal: 2.2, ts: 1 });
  });

  test("loadPricedBookEvents joins skin_events to latest odds and dedupes", () => {
    const db = makeDb();
    db.run("INSERT INTO skin_events (sport, league, home, away, competition_id, odds_event_id) VALUES ('tennis','ATP','A','B','tennis.atp','e1')");
    db.run("INSERT INTO skin_events (sport, league, home, away, competition_id, odds_event_id) VALUES ('tennis','ATP','A','B','tennis.atp','e1')"); // dup
    db.run("INSERT INTO skin_events (sport, league, home, away, competition_id, odds_event_id) VALUES ('tennis','ITF','C','D','tennis.itf',NULL)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1','home',1.55,300)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1','away',2.60,300)");
    const events = loadPricedBookEvents(db, "tennis");
    expect(events).toHaveLength(2);
    const priced = events.find((e) => e.home === "A")!;
    expect(priced.homeDecimal).toBe(1.55);
    expect(priced.awayDecimal).toBe(2.6);
    expect(priced.asOf).toBe(300);
    const unpriced = events.find((e) => e.home === "C")!;
    expect(unpriced.homeDecimal).toBeNull();
    expect(unpriced.awayDecimal).toBeNull();
  });
});
