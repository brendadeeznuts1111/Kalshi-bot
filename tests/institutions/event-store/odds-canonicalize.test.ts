import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  backfillMatchKeys,
  canonicalizeOddsSides,
} from "../../../src/institutions/event-store/odds-canonicalize.ts";
import { latestOddsByMatchKey } from "../../../src/institutions/event-store/odds-ticks-store.ts";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("CREATE TABLE events (event_id TEXT PRIMARY KEY, player_a TEXT, player_b TEXT, winner TEXT, loser TEXT)");
  db.run("CREATE TABLE event_links (stadion_event_id TEXT, kalshi_event_id TEXT, match_key TEXT, status TEXT)");
  db.run("CREATE TABLE odds_ticks (id INTEGER PRIMARY KEY, event_id TEXT, side TEXT, decimal_odds REAL, ts INTEGER, match_key TEXT, source TEXT DEFAULT '', source_url TEXT DEFAULT '', fetched_ts INTEGER, corpus TEXT DEFAULT 'trading', implied_prob REAL, limit_context TEXT)");
  return db;
}

describe("backfillMatchKeys (canonical match_key joins)", () => {
  test("copies match_key from event_links onto linked odds rows", () => {
    const db = makeDb();
    db.run("INSERT INTO event_links (stadion_event_id, kalshi_event_id, match_key) VALUES ('e1', 'k1', '2026-07-22|KXITFWMATCH|pace|trevisan')");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1', 'home', 1.5, 1)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('unlinked', 'away', 2.0, 1)");
    const r = backfillMatchKeys(db);
    expect(r.updated).toBe(1);
    const row = db.query("SELECT match_key FROM odds_ticks WHERE event_id = 'e1'").get() as { match_key: string | null };
    expect(row.match_key).toBe("2026-07-22|KXITFWMATCH|pace|trevisan");
    const unlinked = db.query("SELECT match_key FROM odds_ticks WHERE event_id = 'unlinked'").get() as { match_key: string | null };
    expect(unlinked.match_key).toBeNull();
  });

  test("falls back to the kalshi_event_id side of the link", () => {
    const db = makeDb();
    db.run("INSERT INTO event_links (stadion_event_id, kalshi_event_id, match_key) VALUES ('s1', 'e2', 'mk')");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e2', 'away', 2.0, 1)");
    expect(backfillMatchKeys(db).updated).toBe(1);
    expect((db.query("SELECT match_key FROM odds_ticks WHERE event_id = 'e2'").get() as { match_key: string | null }).match_key).toBe("mk");
  });
});

describe("canonicalizeOddsSides (winner/loser → home/away)", () => {
  test("resolves winner/loser through events names", () => {
    const db = makeDb();
    db.run("INSERT INTO events (event_id, player_a, player_b, winner, loser) VALUES ('e1', 'Ann Pace', 'Bob Trevisan', 'Ann Pace', 'Bob Trevisan')");
    db.run("INSERT INTO odds_ticks (id, event_id, side, decimal_odds, ts) VALUES (1, 'e1', 'winner', 1.4, 1)");
    db.run("INSERT INTO odds_ticks (id, event_id, side, decimal_odds, ts) VALUES (2, 'e1', 'loser', 3.1, 1)");
    expect(canonicalizeOddsSides(db).updated).toBe(2);
    const sides = db.query("SELECT side FROM odds_ticks ORDER BY id").all() as Array<{ side: string }>;
    expect(sides.map((s) => s.side)).toEqual(["home", "away"]);
  });

  test("leaves unresolvable rows untouched", () => {
    const db = makeDb();
    db.run("INSERT INTO events (event_id, player_a, player_b, winner, loser) VALUES ('e1', 'Ann Pace', 'Bob Trevisan', 'Ann Pace', 'Bob Trevisan')");
    db.run("INSERT INTO odds_ticks (id, event_id, side, decimal_odds, ts) VALUES (1, 'e2', 'winner', 1.4, 1)");
    expect(canonicalizeOddsSides(db).updated).toBe(0);
    expect((db.query("SELECT side FROM odds_ticks WHERE id = 1").get() as { side: string }).side).toBe("winner");
  });
});

describe("latestOddsByMatchKey", () => {
  test("joins through event_links and returns latest per side", () => {
    const db = makeDb();
    db.run("INSERT INTO event_links (stadion_event_id, kalshi_event_id, match_key) VALUES ('e1', 'k1', 'mk-1')");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1', 'home', 1.5, 1)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1', 'home', 1.6, 2)");
    db.run("INSERT INTO odds_ticks (event_id, side, decimal_odds, ts) VALUES ('e1', 'away', 2.7, 2)");
    const odds = latestOddsByMatchKey(db, "mk-1");
    expect(odds.home).toEqual({ decimal: 1.6, ts: 2 });
    expect(odds.away).toEqual({ decimal: 2.7, ts: 2 });
  });
});
