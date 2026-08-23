import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  latestOddsForEvent,
  loadPricedBookEvents,
} from "../../../src/institutions/event-store/odds-ticks-store.ts";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("CREATE TABLE skin_events (id INTEGER PRIMARY KEY, sport TEXT, league TEXT, home TEXT, away TEXT, competition_id TEXT, odds_event_id TEXT)");
  db.run("CREATE TABLE odds_ticks (id INTEGER PRIMARY KEY, event_id TEXT, side TEXT, decimal_odds REAL, ts INTEGER)");
  return db;
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
