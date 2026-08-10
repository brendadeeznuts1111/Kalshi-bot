// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  migratePartnerEventsToSkinEvents,
  migrateSkinEventsInventoryIdentity,
  openEventStore,
} from '../../src/institutions/event-store/open-db.ts';
import type { PartnerLiveEvent } from '../../src/partner/types.ts';
import {
  buckeyeInventoryIdentity,
  filterLiveEventsBySport,
  listSkinStreamIds,
  liveProductsCoveredByInventory,
  normalizeInventorySport,
  resolveWatchInventoryIdentity,
  upsertSkinLiveEvents,
} from '../../src/partner/skin-events-store.ts';

function ev(
  partial: Partial<PartnerLiveEvent> & { streamId: number; sport: string }
): PartnerLiveEvent {
  return {
    partner: 'fantasy402',
    sport: partial.sport,
    league: partial.league ?? 'League',
    eventId: String(partial.streamId),
    home: partial.home ?? 'A',
    away: partial.away ?? 'B',
    streamId: partial.streamId,
    feedId: partial.feedId ?? 0,
    donbestId: null,
  };
}

describe('skin_events store', () => {
  test('filterLiveEventsBySport separates tennis vs table tennis', () => {
    const rows = [
      ev({ streamId: 1, sport: 'Tennis' }),
      ev({ streamId: 2, sport: 'Table tennis' }),
      ev({ streamId: 3, sport: 'Table Tennis' }),
    ];
    expect(filterLiveEventsBySport(rows, 'table_tennis').map(e => e.streamId)).toEqual([2, 3]);
    expect(filterLiveEventsBySport(rows, 'tennis').map(e => e.streamId)).toEqual([1]);
  });

  test('normalizeInventorySport maps Table Tennis → table_tennis', () => {
    expect(normalizeInventorySport('Table Tennis')).toBe('table_tennis');
    expect(normalizeInventorySport('table_tennis')).toBe('table_tennis');
    expect(normalizeInventorySport('Tennis')).toBe('tennis');
  });

  test('buckeye inventory covers plive + ezlive (no duplicate rows)', () => {
    expect(liveProductsCoveredByInventory('buckeye').sort()).toEqual(['ezlive', 'plive']);
    const id = buckeyeInventoryIdentity();
    expect(id.skinId).toBe('buckeye');
    expect(id.bookId).toBe('fantasy402');
    expect(id.inventoryLiveProduct).toBe('plive');
  });

  test('resolveWatchInventoryIdentity defaults and rejects non-buckeye', () => {
    expect(resolveWatchInventoryIdentity({}).skinId).toBe('buckeye');
    expect(() => resolveWatchInventoryIdentity({ skin: 'ace' })).toThrow(/buckeye only/);
    expect(() => resolveWatchInventoryIdentity({ book: 'parlay21' })).toThrow(/fantasy402 only/);
  });

  test('upsertSkinLiveEvents stamps skin/book/inventory product once per stream', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const first = [
      ev({ streamId: 100, sport: 'Table tennis', home: 'P1', away: 'P2' }),
      ev({ streamId: 101, sport: 'Table tennis' }),
    ];
    const r1 = upsertSkinLiveEvents(db, first, { nowMs: 1_000 });
    expect(r1.inserted.length).toBe(2);
    expect(r1.updated.length).toBe(0);
    expect(listSkinStreamIds(db, 'fantasy402').size).toBe(2);
    expect(r1.inserted[0]?.skinId).toBe('buckeye');
    expect(r1.inserted[0]?.bookId).toBe('fantasy402');
    expect(r1.inserted[0]?.inventoryLiveProduct).toBe('plive');
    expect(r1.inserted[0]?.sport).toBe('table_tennis');

    const second = [
      ev({ streamId: 100, sport: 'Table tennis', home: 'P1', away: 'P2x' }),
      ev({ streamId: 102, sport: 'Table tennis' }),
    ];
    const r2 = upsertSkinLiveEvents(db, second, { nowMs: 2_000 });
    expect(r2.inserted.length).toBe(1);
    expect(r2.inserted[0]!.streamId).toBe('102');
    expect(r2.updated.length).toBe(1);
    expect(listSkinStreamIds(db, 'fantasy402').size).toBe(3);

    const row = db
      .query(
        `SELECT home, away, last_updated AS lastUpdated, sport, skin_id AS skinId,
                book_id AS bookId, inventory_live_product AS inv
         FROM skin_events WHERE stream_id = '100'`
      )
      .get() as {
      home: string;
      away: string;
      lastUpdated: number;
      sport: string;
      skinId: string;
      bookId: string;
      inv: string;
    };
    expect(row.away).toBe('P2x');
    expect(row.lastUpdated).toBe(2_000);
    expect(row.sport).toBe('table_tennis');
    expect(row.skinId).toBe('buckeye');
    expect(row.bookId).toBe('fantasy402');
    expect(row.inv).toBe('plive');

    // One row covers both products — no second insert for ezlive
    const count = (
      db.query(`SELECT COUNT(*) AS c FROM skin_events WHERE stream_id = '100'`).get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);
  });

  test('migrate deletes Test League fixture and backfills fantasy402 rows', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    db.run(`
      INSERT INTO skin_events (
        partner, stream_id, sport, league, home, away, status, first_seen, last_updated
      ) VALUES
        ('fantasy402', '1', 'table_tennis', 'Test League', 'A', 'B', 'unknown', 1, 1),
        ('fantasy402', '999', 'Table Tennis', 'Setka', 'X', 'Y', 'unknown', 2, 2)
    `);
    migrateSkinEventsInventoryIdentity(db);
    const leftover = (
      db.query(`SELECT COUNT(*) AS c FROM skin_events WHERE stream_id = '1'`).get() as {
        c: number;
      }
    ).c;
    expect(leftover).toBe(0);
    const row = db
      .query(
        `SELECT skin_id AS skinId, book_id AS bookId, inventory_live_product AS inv
         FROM skin_events WHERE stream_id = '999'`
      )
      .get() as { skinId: string; bookId: string; inv: string };
    expect(row.skinId).toBe('buckeye');
    expect(row.bookId).toBe('fantasy402');
    expect(row.inv).toBe('plive');
  });

  test('migratePartnerEventsToSkinEvents renames legacy table', () => {
    const db = new Database(':memory:');
    db.run(`
      CREATE TABLE partner_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        partner TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        sport TEXT NOT NULL DEFAULT '',
        league TEXT NOT NULL DEFAULT '',
        home TEXT,
        away TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        first_seen INTEGER NOT NULL,
        last_updated INTEGER NOT NULL,
        UNIQUE(partner, stream_id)
      )
    `);
    db.run(`
      INSERT INTO partner_events (partner, stream_id, sport, league, status, first_seen, last_updated)
      VALUES ('fantasy402', '42', 'tennis', 'ATP', 'unknown', 1, 1)
    `);
    migratePartnerEventsToSkinEvents(db);
    const legacy = db
      .query(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='partner_events'`)
      .get();
    expect(legacy).toBeNull();
    const count = (
      db.query(`SELECT COUNT(*) AS c FROM skin_events WHERE stream_id = '42'`).get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);
  });
});
