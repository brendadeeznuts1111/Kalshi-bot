// Companion test for src/institutions/massey/store.ts — Massey cache DB
// (open/migrate, snapshot id, upsert, latest-snapshot queries).
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  applyMasseySchema,
  latestMasseyRatings,
  latestMasseySnapshotAgeMs,
  latestMasseySnapshotId,
  masseySnapshotId,
  openMasseyDb,
  upsertMasseyRatings,
} from '../../../src/institutions/massey/store.ts';
import { DEFAULT_MASSEY_DB } from '../../../src/institutions/massey/paths.ts';
import type { MasseyRatingsTable } from '../../../src/institutions/massey/fetch.ts';

const TARGET = {
  inventoryBucket: 'volleyball',
  masseySport: 'cvol',
  subdivision: 'ncaa-d1',
  label: 'College Women Volleyball D1',
} as const;

const HEADERS = ['Rank', 'Team', 'Rec', 'Δ', 'Rat', 'Pwr', 'HFA', 'SoS', 'SSF', 'EW', 'EL'];
const ROWS = [
  ['1', 'Nebraska', '0-0', '0.00', '19.25', '14.88', '0.17', '10', '193.46', '22.24', '0.76'],
  ['2', 'Texas', '0-0', '-1.00', '18.50', '14.10', '0.15', '9', '188.10', '21.00', '0.70'],
];

function table(fetchedAtMs: number): MasseyRatingsTable {
  return {
    url: 'https://masseyratings.com/cvol/2026/ratings',
    title: 'CV Ratings',
    fetchedAtMs,
    headers: HEADERS,
    rows: ROWS,
    target: { ...TARGET },
    path: 'native-fetch',
  };
}

function memDb(): Database {
  const db = new Database(':memory:');
  applyMasseySchema(db);
  return db;
}

describe('massey store', () => {
  test('masseySnapshotId uses sport/subdivision/fetchedAtMs; - for flat', () => {
    expect(masseySnapshotId({ ...TARGET }, 1234)).toBe('cvol/ncaa-d1/1234');
    expect(masseySnapshotId({ ...TARGET, subdivision: '' }, 7)).toBe('cvol/-/7');
  });

  test('openMasseyDb(:memory:) applies schema and never caches', () => {
    const db1 = openMasseyDb(':memory:');
    const tables = db1.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('massey_snapshots','massey_ratings')").all();
    expect(tables).toHaveLength(2);
    const db2 = openMasseyDb(':memory:');
    expect(db1).not.toBe(db2);
  });

  test('openMasseyDb(tmp file) creates file + WAL + schema, then cleans up', () => {
    const dir = mkdtempSync('/tmp/massey-store-');
    const path = join(dir, 'massey.db');
    try {
      const db = openMasseyDb(path);
      expect(db.query('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
      expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='massey_ratings'").get()).not.toBeNull();
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('applyMasseySchema is idempotent', () => {
    const db = new Database(':memory:');
    applyMasseySchema(db);
    applyMasseySchema(db);
    expect(db.query("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='massey_ratings'").get()).toMatchObject({ c: 1 });
  });

  test('upsertMasseyRatings writes snapshot + parsed rows; re-upsert replaces', () => {
    const db = memDb();
    const r1 = upsertMasseyRatings(db, table(1000));
    expect(r1.snapshotId).toBe('cvol/ncaa-d1/1000');
    expect(r1.rowCount).toBe(2);
    expect(r1.parsedCount).toBe(2);
    expect(db.query('SELECT COUNT(*) c FROM massey_ratings').get()).toMatchObject({ c: 2 });
    const snap = db.query('SELECT * FROM massey_snapshots WHERE snapshot_id = ?').get('cvol/ncaa-d1/1000') as Record<string, unknown>;
    expect(snap.row_count).toBe(2);
    expect(snap.sport).toBe('cvol');
    // Same snapshot again — INSERT OR REPLACE keeps exactly 2 rating rows.
    upsertMasseyRatings(db, table(1000));
    expect(db.query('SELECT COUNT(*) c FROM massey_ratings').get()).toMatchObject({ c: 2 });
  });

  test('latestMasseySnapshotId returns newest per target, null when none', () => {
    const db = memDb();
    expect(latestMasseySnapshotId(db, TARGET)).toBeNull();
    upsertMasseyRatings(db, table(500));
    upsertMasseyRatings(db, table(900));
    expect(latestMasseySnapshotId(db, TARGET)).toBe('cvol/ncaa-d1/900');
    expect(latestMasseySnapshotId(db, { ...TARGET, masseySport: 'nope' })).toBeNull();
  });

  test('latestMasseySnapshotAgeMs returns age, null when none', () => {
    const db = memDb();
    expect(latestMasseySnapshotAgeMs(db, TARGET)).toBeNull();
    upsertMasseyRatings(db, table(Date.now() - 60_000));
    const age = latestMasseySnapshotAgeMs(db, TARGET);
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(55_000);
    expect(age!).toBeLessThan(120_000);
  });

  test('latestMasseyRatings returns rank-asc rows, null-coalesces missing numerics', () => {
    const db = memDb();
    expect(latestMasseyRatings(db, TARGET)).toEqual([]);
    upsertMasseyRatings(db, table(1000));
    const rows = latestMasseyRatings(db, TARGET);
    expect(rows.map((r) => r.team)).toEqual(['Nebraska', 'Texas']);
    expect(rows[0]!.rating).toBe(19.25);
    expect(rows[0]!.power).toBe(14.88);
    expect(rows[0]!.hfa).toBe(0.17);
    // Null out numerics — reader must map to null, not NaN/0.
    db.run('UPDATE massey_ratings SET rating = NULL, wins = NULL WHERE rank = 1');
    const after = latestMasseyRatings(db, TARGET);
    expect(after[0]!.rating).toBeNull();
    expect(after[0]!.wins).toBeNull();
    expect(after[0]!.team).toBe('Nebraska');
  });
});
