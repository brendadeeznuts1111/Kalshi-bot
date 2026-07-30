// @see https://bun.com/docs/test — bun:test
// @see https://bun.com/docs/runtime/sqlite — bun:sqlite
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildPlayerProfiles,
  loadVolumeMapFromPriceSnapshots,
} from "../../tools/tennis/build-player-profiles.ts";
import { readPlayerProfiles } from "../../src/research/player-profiles.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function seedDb(): Database {
  const db = new Database(":memory:");
  db.run(`CREATE TABLE events (
    event_id TEXT PRIMARY KEY, player_a TEXT, player_b TEXT, winner TEXT, loser TEXT,
    start_ts TEXT, surface TEXT DEFAULT 'hard', outcome TEXT DEFAULT 'completed',
    corpus TEXT NOT NULL DEFAULT 'trading'
  )`);
  db.run(`CREATE TABLE markets (
    market_id TEXT PRIMARY KEY, event_id TEXT, volume_fp TEXT, volume_24h_fp TEXT
  )`);
  db.run(`CREATE TABLE price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kalshi_volume_24h REAL
  )`);
  db.run(`CREATE TABLE player_profiles (
    player_name TEXT PRIMARY KEY,
    first_seen_ts INTEGER NOT NULL,
    last_seen_ts INTEGER NOT NULL,
    appearances INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    win_rate REAL,
    surfaces TEXT,
    avg_kalshi_volume_fp REAL,
    corpus TEXT NOT NULL DEFAULT 'trading',
    country TEXT
  )`);
  return db;
}

function seedEvents(db: Database): void {
  const ins = db.query(
    `INSERT INTO events (event_id, player_a, player_b, winner, loser, start_ts, surface, corpus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Alice/Bob on hard; Carol research-only excluded
  ins.run("e1", "Alice", "Bob", "Alice", "Bob", "2026-01-01T12:00:00Z", "hard", "trading");
  ins.run("e2", "Bob", "Alice", "Alice", "Bob", "2026-01-05T12:00:00Z", "clay", "trading");
  ins.run("e3", "Alice", "Bob", "Bob", "Alice", "2026-01-10T12:00:00Z", "hard", "trading");
  ins.run("e4", "Carol", "Alice", "Carol", "Alice", "2026-01-12T12:00:00Z", "hard", "research-only");

  const mv = db.query(
    `INSERT INTO markets (market_id, event_id, volume_fp, volume_24h_fp) VALUES (?, ?, ?, ?)`,
  );
  mv.run("m1", "e1", "1000000", null);
  mv.run("m2", "e2", "1000000", "3000000"); // prefer 24h
  // e3 no market → volume count only from e1+e2
  mv.run("m4", "e4", "9999999", null); // research-only event excluded
}

describe("build-player-profiles", () => {
  let db: Database;
  beforeEach(() => {
    db = seedDb();
    seedEvents(db);
  });
  afterEach(() => {
    db.close();
  });

  test("populates avg volume from markets (24h preferred over lifetime)", () => {
    const { playersUpserted, volumeFromMarkets } = buildPlayerProfiles(db);
    expect(playersUpserted).toBe(2); // Alice + Bob only
    expect(volumeFromMarkets).toBe(2);

    const alice = db
      .query(
        `SELECT appearances, wins, losses, win_rate, avg_kalshi_volume_fp, last_seen_ts
         FROM player_profiles WHERE player_name = 'Alice'`,
      )
      .get() as {
      appearances: number;
      wins: number;
      losses: number;
      win_rate: number;
      avg_kalshi_volume_fp: number;
      last_seen_ts: number;
    };

    expect(alice.appearances).toBe(3);
    expect(alice.wins).toBe(2);
    expect(alice.losses).toBe(1);
    expect(alice.win_rate).toBeCloseTo(2 / 3, 5);
    // (1M + 3M) / 2  — e3 has no market volume
    expect(alice.avg_kalshi_volume_fp).toBe(2_000_000);
    expect(alice.last_seen_ts).toBe(new Date("2026-01-10T12:00:00Z").getTime());
  });

  test("merges price_snapshots volume when markets empty", () => {
    // Strip market volumes; leave snapshots
    db.run("DELETE FROM markets");
    db.run(
      `INSERT INTO price_snapshots (event_id, ts, kalshi_volume_24h) VALUES
       ('e1', 1, 500000),
       ('e1', 2, 700000),
       ('e2', 3, 900000)`,
    );
    const map = loadVolumeMapFromPriceSnapshots(db);
    // Alice appears in e1 + e2 snapshots → avg of all her side rows
    expect(map.get("Alice")).toBeCloseTo((500000 + 700000 + 900000) / 3, 5);
    expect(map.get("Bob")).toBeCloseTo((500000 + 700000 + 900000) / 3, 5);

    const { volumeFromSnapshots, volumeFromMarkets } = buildPlayerProfiles(db);
    expect(volumeFromMarkets).toBe(0);
    expect(volumeFromSnapshots).toBe(2);
    const alice = db
      .query(`SELECT avg_kalshi_volume_fp FROM player_profiles WHERE player_name = 'Alice'`)
      .get() as { avg_kalshi_volume_fp: number };
    expect(alice.avg_kalshi_volume_fp).toBeCloseTo((500000 + 700000 + 900000) / 3, 5);
  });

  test("caps future lastSeen to now", () => {
    const now = new Date("2026-06-01T00:00:00Z").getTime();
    db.run(`UPDATE events SET start_ts = '2027-01-01T00:00:00Z' WHERE event_id = 'e3'`);
    buildPlayerProfiles(db, false, now);
    const alice = db
      .query(`SELECT last_seen_ts FROM player_profiles WHERE player_name = 'Alice'`)
      .get() as { last_seen_ts: number };
    expect(alice.last_seen_ts).toBe(now);
  });

  test("dry-run writes nothing", () => {
    buildPlayerProfiles(db, true);
    const n = db.query("SELECT COUNT(*) n FROM player_profiles").get() as { n: number };
    expect(n.n).toBe(0);
  });

  test("rebuild wipes stale rows", () => {
    buildPlayerProfiles(db);
    db.run(
      `INSERT INTO player_profiles (player_name, first_seen_ts, last_seen_ts, appearances)
       VALUES ('Stale', 0, 0, 1)`,
    );
    buildPlayerProfiles(db);
    const stale = db
      .query(`SELECT COUNT(*) n FROM player_profiles WHERE player_name = 'Stale'`)
      .get() as { n: number };
    expect(stale.n).toBe(0);
  });
});

describe("readPlayerProfiles", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "profiles-"));
    dbPath = join(dir, "event-store.db");
    const db = new Database(dbPath);
    db.run(`CREATE TABLE player_profiles (
      player_name TEXT PRIMARY KEY,
      first_seen_ts INTEGER NOT NULL,
      last_seen_ts INTEGER NOT NULL,
      appearances INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      win_rate REAL,
      surfaces TEXT,
      avg_kalshi_volume_fp REAL,
      corpus TEXT NOT NULL DEFAULT 'trading',
      country TEXT
    )`);
    const ins = db.query(
      `INSERT INTO player_profiles
       (player_name, first_seen_ts, last_seen_ts, appearances, wins, losses, win_rate,
        surfaces, avg_kalshi_volume_fp, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    ins.run("LowVol", now - 86400000, now - 86400000, 10, 5, 5, 0.5, "{}", 100, "USA");
    ins.run("HighVol", now - 3600000, now + 86400000, 3, 2, 1, 2 / 3, "{}", 9_000_000, "ESP");
    db.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("sorts by volume by default and reports warehouse source", () => {
    const r = readPlayerProfiles({ dbPath, limit: 10 });
    expect(r.state).toBe("ok");
    if (r.state !== "ok") return;
    expect(r.profilesSource).toBe("warehouse");
    expect(r.players[0]?.name).toBe("HighVol");
    expect(r.players[0]?.avgKalshiVolume).toBe(9_000_000);
  });

  test("caps future lastSeenAt at read time", () => {
    const r = readPlayerProfiles({ dbPath, search: "HighVol" });
    expect(r.state).toBe("ok");
    if (r.state !== "ok") return;
    const last = r.players[0]?.lastSeenAt;
    expect(last).toBeTruthy();
    expect(new Date(last!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("unavailable when DB missing", () => {
    const r = readPlayerProfiles({ dbPath: "/nonexistent/nope.db" });
    expect(r.state).toBe("unavailable");
    if (r.state === "unavailable") {
      expect(r.profilesSource).toBe("seed");
    }
  });
});
