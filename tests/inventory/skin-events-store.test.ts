// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  migratePartnerEventsToSkinEvents,
  migrateSkinEventsCompetitionIds,
  migrateSkinEventsInventoryIdentity,
  migrateSkinEventsStreamIdToInventoryId,
} from '../../src/institutions/event-store/open-db.ts';
import {
  buckeyeInventoryIdentity,
  fetchPublicPliveStreamEvents,
  filterLiveEventsBySport,
  listSkinInventoryIds,
  liveProductsCoveredByInventory,
  normalizeInventorySport,
  normalizeSkinEventsSports,
  resolveInventoryCompetitionId,
  resolveWatchInventoryIdentity,
  stampSkinEventsCompetitionIds,
  upsertSkinLiveEvents,
} from '../../src/inventory/skin-events-store.ts';
import { liveEvent, memoryDb } from './fixtures.ts';

function ev(
  partial: { inventoryId: string; sport: string; league?: string; home?: string; away?: string; feedId?: number }
) {
  return liveEvent(
    partial.inventoryId,
    partial.sport,
    partial.home ?? 'A',
    partial.away ?? 'B',
    partial.league ?? 'League'
  );
}

describe('skin_events store', () => {
  test('filterLiveEventsBySport separates tennis vs table tennis', () => {
    const rows = [
      ev({ inventoryId: '1', sport: 'Tennis' }),
      ev({ inventoryId: '2', sport: 'Table tennis' }),
      ev({ inventoryId: '3', sport: 'Table Tennis' }),
    ];
    expect(filterLiveEventsBySport(rows, 'table_tennis').map(e => e.inventoryId)).toEqual([
      '2',
      '3',
    ]);
    expect(filterLiveEventsBySport(rows, 'tennis').map(e => e.inventoryId)).toEqual(['1']);
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
    expect(String(id.bookId)).toBe('fantasy402');
    expect(id.inventoryLiveProduct).toBe('plive');
  });

  test('resolveWatchInventoryIdentity defaults and rejects non-buckeye', () => {
    expect(resolveWatchInventoryIdentity({}).skinId).toBe('buckeye');
    expect(() => resolveWatchInventoryIdentity({ skin: 'ace' })).toThrow(/buckeye only/);
    expect(() => resolveWatchInventoryIdentity({ book: 'parlay21' })).toThrow(/fantasy402 only/);
  });

  test('upsertSkinLiveEvents stamps skin/book/inventory product once per inventory id', () => {
    const db = memoryDb();
    const first = [
      ev({
        inventoryId: '100',
        sport: 'Table tennis',
        league: 'Setka Cup',
        home: 'P1',
        away: 'P2',
      }),
      ev({ inventoryId: '101', sport: 'Table tennis', league: 'Junk League XYZ' }),
    ];
    const r1 = upsertSkinLiveEvents(db, first, { nowMs: 1_000 });
    expect(r1.inserted.length).toBe(2);
    expect(r1.updated.length).toBe(0);
    expect(listSkinInventoryIds(db, 'fantasy402').size).toBe(2);
    expect(r1.inserted[0]?.skinId).toBe('buckeye');
    expect(String(r1.inserted[0]?.bookId)).toBe('fantasy402');
    expect(r1.inserted[0]?.inventoryLiveProduct).toBe('plive');
    expect(r1.inserted[0]?.sport).toBe('table_tennis');
    expect(r1.inserted[0]?.competitionId).toBe('table_tennis.setka_cup');
    expect(r1.inserted[1]?.competitionId).toBeNull();

    const second = [
      ev({
        inventoryId: '100',
        sport: 'Table tennis',
        league: 'Setka Cup',
        home: 'P1',
        away: 'P2x',
      }),
      ev({ inventoryId: '102', sport: 'Table tennis', league: 'Setka Cup' }),
    ];
    const r2 = upsertSkinLiveEvents(db, second, { nowMs: 2_000 });
    expect(r2.inserted.length).toBe(1);
    expect(r2.inserted[0]!.inventoryId).toBe('102');
    expect(r2.inserted[0]!.competitionId).toBe('table_tennis.setka_cup');
    expect(r2.updated.length).toBe(1);
    expect(listSkinInventoryIds(db, 'fantasy402').size).toBe(3);

    const row = db
      .query(
        `SELECT home, away, last_updated AS lastUpdated, sport, skin_id AS skinId,
                book_id AS bookId, inventory_live_product AS inv,
                competition_id AS competitionId
         FROM skin_events WHERE inventory_id = '100'`
      )
      .get() as {
      home: string;
      away: string;
      lastUpdated: number;
      sport: string;
      skinId: string;
      bookId: string;
      inv: string;
      competitionId: string | null;
    };
    expect(row.away).toBe('P2x');
    expect(row.lastUpdated).toBe(2_000);
    expect(row.sport).toBe('table_tennis');
    expect(row.skinId).toBe('buckeye');
    expect(row.bookId).toBe('fantasy402');
    expect(row.inv).toBe('plive');
    expect(row.competitionId).toBe('table_tennis.setka_cup');

    // One row covers both products — no second insert for ezlive
    const count = (
      db.query(`SELECT COUNT(*) AS c FROM skin_events WHERE inventory_id = '100'`).get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);
  });

  test('resolveInventoryCompetitionId maps Setka Cup; unknown stays null', () => {
    expect(
      resolveInventoryCompetitionId({
        liveProduct: 'plive',
        sport: 'table_tennis',
        league: 'Setka Cup',
      })
    ).toBe('table_tennis.setka_cup');
    expect(
      resolveInventoryCompetitionId({
        liveProduct: 'ezlive',
        sport: 'table_tennis',
        league: 'Setka Cup',
      })
    ).toBe('table_tennis.setka_cup');
    expect(
      resolveInventoryCompetitionId({
        liveProduct: 'plive',
        sport: 'table_tennis',
        league: 'Not A Real League',
      })
    ).toBeNull();
    // sport alone (no bucket) must still resolve soccer → football mapping
    expect(
      resolveInventoryCompetitionId({
        liveProduct: 'plive',
        sport: 'soccer',
        league: 'USA MPL',
      })
    ).toBe('soccer.usa_mpl');
    expect(
      resolveInventoryCompetitionId({
        liveProduct: 'plive',
        sport: 'tennis',
        league: 'ATT. Togliatti',
      })
    ).toBe('tennis.att_togliatti');
  });

  test('migrateSkinEventsCompetitionIds backfills null competition_id', () => {
    const db = memoryDb();
    db.run(`
      INSERT INTO skin_events (
        partner, inventory_id, sport, league, status, first_seen, last_updated,
        skin_id, book_id, inventory_live_product
      ) VALUES (
        'fantasy402', '88', 'table_tennis', 'Setka Cup', 'unknown', 1, 1,
        'buckeye', 'fantasy402', 'plive'
      )
    `);
    migrateSkinEventsCompetitionIds(db);
    const cid = (
      db.query(`SELECT competition_id AS c FROM skin_events WHERE inventory_id = '88'`).get() as {
        c: string | null;
      }
    ).c;
    expect(cid).toBe('table_tennis.setka_cup');
    expect(stampSkinEventsCompetitionIds(db)).toBe(0);
  });

  test('migrate deletes Test League fixture and backfills fantasy402 rows', () => {
    const db = memoryDb();
    db.run(`
      INSERT INTO skin_events (
        partner, inventory_id, sport, league, home, away, status, first_seen, last_updated,
        book_id
      ) VALUES
        ('fantasy402', '1', 'table_tennis', 'Test League', 'A', 'B', 'unknown', 1, 1, 'fantasy402'),
        ('fantasy402', '999', 'Table Tennis', 'Setka', 'X', 'Y', 'unknown', 2, 2, 'fantasy402')
    `);
    migrateSkinEventsInventoryIdentity(db);
    const leftover = (
      db.query(`SELECT COUNT(*) AS c FROM skin_events WHERE inventory_id = '1'`).get() as {
        c: number;
      }
    ).c;
    expect(leftover).toBe(0);
    const row = db
      .query(
        `SELECT skin_id AS skinId, book_id AS bookId, inventory_live_product AS inv
         FROM skin_events WHERE inventory_id = '999'`
      )
      .get() as { skinId: string; bookId: string; inv: string };
    expect(row.skinId).toBe('buckeye');
    expect(row.bookId).toBe('fantasy402');
    expect(row.inv).toBe('plive');
  });

  test('normalizeSkinEventsSports rewrites display labels', () => {
    const db = memoryDb();
    db.run(`
      INSERT INTO skin_events (
        partner, inventory_id, sport, league, status, first_seen, last_updated, book_id
      ) VALUES ('fantasy402', '7', 'Table Tennis', 'Setka', 'unknown', 1, 1, 'fantasy402')
    `);
    expect(normalizeSkinEventsSports(db)).toBe(1);
    const sport = (
      db.query(`SELECT sport FROM skin_events WHERE inventory_id = '7'`).get() as {
        sport: string;
      }
    ).sport;
    expect(sport).toBe('table_tennis');
  });

  test('fetchPublicPliveStreamEvents maps wire stream_id → inventoryId', async () => {
    const wire = {
      sports: {
        table_tennis: {
          count: 1,
          events: [
            {
              stream_id: 55,
              league: 'Setka',
              sport: 'Table Tennis',
              home: 'A',
              away: 'B',
              feed_id: 1,
              competitiors: [],
            },
          ],
        },
      },
    };
    const events = await fetchPublicPliveStreamEvents({
      sport: 'table_tennis',
      fetchImpl: (async () =>
        new Response(JSON.stringify(wire), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    expect(events.length).toBe(1);
    expect(events[0]?.inventoryId).toBe('55');
  });

  test('migratePartnerEventsToSkinEvents then renames stream_id → inventory_id', () => {
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
    migrateSkinEventsStreamIdToInventoryId(db);
    const legacy = db
      .query(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='partner_events'`)
      .get();
    expect(legacy).toBeNull();
    const count = (
      db.query(`SELECT COUNT(*) AS c FROM skin_events WHERE inventory_id = '42'`).get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(1);
  });
});
