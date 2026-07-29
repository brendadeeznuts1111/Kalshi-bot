// @see https://bun.com/docs/test — bun:test
// @see https://bun.com/docs/runtime/sqlite — bun:sqlite
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { buildPlayerOpponentProfiles } from "../../tools/tennis/build-player-opponent-profiles.ts";
import { readOpponentProfiles } from "../../src/research/player-opponent-profiles.ts";

function seedDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE events (
    event_id TEXT PRIMARY KEY, player_a TEXT, player_b TEXT, winner TEXT, loser TEXT,
    start_ts TEXT, corpus TEXT NOT NULL DEFAULT 'trading'
  )`);
  db.run(`CREATE TABLE markets (
    market_id TEXT PRIMARY KEY, event_id TEXT, volume_fp TEXT
  )`);
  db.run(`CREATE TABLE player_opponent_profiles (
    player_name TEXT NOT NULL, opponent_name TEXT NOT NULL,
    first_seen_ts INTEGER NOT NULL, last_seen_ts INTEGER NOT NULL,
    matches INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0, win_rate REAL,
    avg_kalshi_volume_fp REAL, corpus TEXT NOT NULL DEFAULT 'trading',
    PRIMARY KEY (player_name, opponent_name)
  )`);
  return db;
}

function seedEvents(db: Database): void {
  const ins = db.query(
    `INSERT INTO events (event_id, player_a, player_b, winner, loser, start_ts, corpus) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // A beats B twice, B beats A once; C vs A once (research-only → excluded)
  ins.run("e1", "Alice", "Bob", "Alice", "Bob", "2026-01-01", "trading");
  ins.run("e2", "Bob", "Alice", "Alice", "Bob", "2026-01-05", "trading");
  ins.run("e3", "Alice", "Bob", "Bob", "Alice", "2026-01-10", "trading");
  ins.run("e4", "Carol", "Alice", "Carol", "Alice", "2026-01-12", "research-only");
  const mv = db.query(`INSERT INTO markets (market_id, event_id, volume_fp) VALUES (?, ?, ?)`);
  mv.run("m1", "e1", "1000000");
  mv.run("m2", "e2", "3000000");
  mv.run("m3", "e4", "9999999"); // excluded with its event
}

describe("build-player-opponent-profiles", () => {
  let db: Database;
  beforeEach(() => {
    db = seedDb();
    seedEvents(db);
  });
  afterEach(() => {
    db.close();
  });

  test("builds both directions with W/L and volume averages", () => {
    const { pairsUpserted } = buildPlayerOpponentProfiles(db);
    // Alice↔Bob both directions only (research-only event excluded)
    expect(pairsUpserted).toBe(2);
    const alice = db
      .query(
        `SELECT matches, wins, losses, win_rate, avg_kalshi_volume_fp
         FROM player_opponent_profiles WHERE player_name = 'Alice' AND opponent_name = 'Bob'`,
      )
      .get() as { matches: number; wins: number; losses: number; win_rate: number; avg_kalshi_volume_fp: number };
    expect(alice.matches).toBe(3);
    expect(alice.wins).toBe(2);
    expect(alice.losses).toBe(1);
    expect(alice.win_rate).toBeCloseTo(2 / 3, 5);
    // volume events e1+e2 (e3 has no market) → avg (1M+3M)/2
    expect(alice.avg_kalshi_volume_fp).toBe(2_000_000);
    const bob = db
      .query(
        `SELECT wins, losses FROM player_opponent_profiles WHERE player_name = 'Bob' AND opponent_name = 'Alice'`,
      )
      .get() as { wins: number; losses: number };
    expect(bob.wins).toBe(1);
    expect(bob.losses).toBe(2);
  });

  test("dry-run writes nothing", () => {
    buildPlayerOpponentProfiles(db, true);
    const n = db.query("SELECT COUNT(*) n FROM player_opponent_profiles").get() as { n: number };
    expect(n.n).toBe(0);
  });

  test("rebuild wipes stale rows", () => {
    buildPlayerOpponentProfiles(db);
    db.run(
      `INSERT INTO player_opponent_profiles (player_name, opponent_name, first_seen_ts, last_seen_ts) VALUES ('Stale', 'Row', 0, 0)`,
    );
    buildPlayerOpponentProfiles(db);
    const stale = db
      .query(`SELECT COUNT(*) n FROM player_opponent_profiles WHERE player_name = 'Stale'`)
      .get() as { n: number };
    expect(stale.n).toBe(0);
  });
});

describe("readOpponentProfiles", () => {
  test("unavailable when DB is missing", () => {
    const r = readOpponentProfiles({ dbPath: "/nonexistent/nope.db" });
    expect(r.state).toBe("unavailable");
  });
});
