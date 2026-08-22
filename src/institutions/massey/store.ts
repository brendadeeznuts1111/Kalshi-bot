// @see https://bun.com/docs/runtime/sqlite
import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { DEFAULT_MASSEY_DB } from "./paths.ts";
import type { MasseySportTarget } from "./sports.ts";
import { parseMasseyRatingRows, type MasseyRatingRow } from "./parse.ts";
import type { MasseyRatingsTable } from "./fetch.ts";

let defaultDb: Database | null = null;

/** Open (and migrate) the Massey cache DB. Mirrors openEventStore style. */
export function openMasseyDb(dbPath: string = DEFAULT_MASSEY_DB): Database {
  if (dbPath === DEFAULT_MASSEY_DB && defaultDb) return defaultDb;
  if (dbPath !== ":memory:") {
    mkdirSync(dbPath.replace(/\/[^/]+$/, ""), { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  if (dbPath !== ":memory:") db.run("PRAGMA journal_mode = WAL;");
  applyMasseySchema(db);
  if (dbPath === DEFAULT_MASSEY_DB) defaultDb = db;
  return db;
}

/** Idempotent schema. */
export function applyMasseySchema(db: Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS massey_snapshots (" +
      "snapshot_id TEXT PRIMARY KEY," +
      "sport TEXT NOT NULL," +
      "subdivision TEXT NOT NULL," +
      "label TEXT NOT NULL DEFAULT \"\"," +
      "url TEXT NOT NULL," +
      "title TEXT NOT NULL DEFAULT \"\"," +
      "fetched_at_ms INTEGER NOT NULL," +
      "row_count INTEGER NOT NULL" +
    ");" +
    "CREATE TABLE IF NOT EXISTS massey_ratings (" +
      "snapshot_id TEXT NOT NULL REFERENCES massey_snapshots(snapshot_id)," +
      "sport TEXT NOT NULL," +
      "subdivision TEXT NOT NULL," +
      "rank INTEGER NOT NULL," +
      "team TEXT NOT NULL," +
      "conference TEXT NOT NULL DEFAULT \"\"," +
      "team_cell TEXT NOT NULL DEFAULT \"\"," +
      "record TEXT NOT NULL DEFAULT \"\"," +
      "wins INTEGER," +
      "losses INTEGER," +
      "win_pct REAL," +
      "delta REAL," +
      "rating REAL," +
      "power REAL," +
      "hfa REAL," +
      "sos REAL," +
      "ssf REAL," +
      "ew REAL," +
      "el REAL," +
      "PRIMARY KEY (snapshot_id, rank)" +
    ");" +
    "CREATE INDEX IF NOT EXISTS idx_massey_ratings_sport_team" +
      " ON massey_ratings (sport, subdivision, team);" +
    "CREATE INDEX IF NOT EXISTS idx_massey_ratings_rating" +
      " ON massey_ratings (sport, subdivision, rating);"
  );
}

export type MasseyUpsertResult = {
  snapshotId: string;
  rowCount: number;
  parsedCount: number;
};

/** Snapshot id: `{sport}/{subdivision}/{fetchedAtMs}`. */
export function masseySnapshotId(target: MasseySportTarget, fetchedAtMs: number): string {
  return target.masseySport + "/" + (target.subdivision || "-") + "/" + fetchedAtMs;
}

/** Store a fetched table: one snapshot row + parsed rating rows. */
export function upsertMasseyRatings(
  db: Database,
  table: MasseyRatingsTable,
): MasseyUpsertResult {
  const snapshotId = masseySnapshotId(table.target, table.fetchedAtMs);
  const rows: MasseyRatingRow[] = parseMasseyRatingRows(table.headers, table.rows);

  db.query(
    "INSERT OR REPLACE INTO massey_snapshots" +
      " (snapshot_id, sport, subdivision, label, url, title, fetched_at_ms, row_count)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    snapshotId,
    table.target.masseySport,
    table.target.subdivision,
    table.target.label,
    table.url,
    table.title,
    table.fetchedAtMs,
    rows.length,
  );

  const insert = db.prepare(
    "INSERT OR REPLACE INTO massey_ratings" +
      " (snapshot_id, sport, subdivision, rank, team, conference, team_cell, record," +
      "  wins, losses, win_pct, delta, rating, power, hfa, sos, ssf, ew, el)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  db.transaction((dbTx) => {
    for (const row of rows) {
      insert.run(
        snapshotId,
        table.target.masseySport,
        table.target.subdivision,
        row.rank,
        row.team,
        row.conference,
        row.teamCell,
        row.record,
        row.wins,
        row.losses,
        row.winPct,
        row.delta,
        row.rating,
        row.power,
        row.hfa,
        row.sos,
        row.ssf,
        row.ew,
        row.el,
      );
    }
  })(db);

  return { snapshotId, rowCount: table.rows.length, parsedCount: rows.length };
}

/** Latest snapshot id per (sport, subdivision). */
export function latestMasseySnapshotId(
  db: Database,
  target: MasseySportTarget,
): string | null {
  const row = db
    .query(
      "SELECT snapshot_id FROM massey_snapshots" +
        " WHERE sport = ? AND subdivision = ? ORDER BY fetched_at_ms DESC LIMIT 1"
    )
    .get(target.masseySport, target.subdivision) as { snapshot_id: string } | null;
  return row?.snapshot_id ?? null;
}

/** Full rating rows for the latest snapshot of a target, rank-asc. */

/** Age in ms of the latest snapshot for a target (null when none). */
export function latestMasseySnapshotAgeMs(
  db: Database,
  target: MasseySportTarget,
): number | null {
  const id = latestMasseySnapshotId(db, target);
  if (!id) return null;
  const row = db
    .query("SELECT fetched_at_ms FROM massey_snapshots WHERE snapshot_id = ?")
    .get(id) as { fetched_at_ms: number } | null;
  return row ? Date.now() - row.fetched_at_ms : null;
}

export function latestMasseyRatings(
  db: Database,
  target: MasseySportTarget,
): MasseyRatingRow[] {
  const id = latestMasseySnapshotId(db, target);
  if (!id) return [];
  const stmt = db.prepare("SELECT * FROM massey_ratings WHERE snapshot_id = ? ORDER BY rank ASC");
  return (stmt.all(id) as Record<string, unknown>[]).map((r) => ({
    rank: Number(r.rank),
    team: String(r.team),
    conference: String(r.conference ?? ""),
    teamCell: String(r.team_cell ?? ""),
    record: String(r.record ?? ""),
    wins: r.wins == null ? null : Number(r.wins),
    losses: r.losses == null ? null : Number(r.losses),
    winPct: r.win_pct == null ? null : Number(r.win_pct),
    delta: r.delta == null ? null : Number(r.delta),
    rating: r.rating == null ? null : Number(r.rating),
    power: r.power == null ? null : Number(r.power),
    hfa: r.hfa == null ? null : Number(r.hfa),
    sos: r.sos == null ? null : Number(r.sos),
    ssf: r.ssf == null ? null : Number(r.ssf),
    ew: r.ew == null ? null : Number(r.ew),
    el: r.el == null ? null : Number(r.el),
  }));
}