// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import {
  countInventoryLeagues,
  listInventoryLeagues,
  planInventoryLeagues,
  upsertInventoryLeagues,
} from '../../src/inventory/leagues.ts';
import { runInventorySync } from '../../src/inventory/sync.ts';
import type { FantasySessionAdapter, InventoryEvent } from '../../src/partner/types.ts';

function live(
  inventoryId: string,
  sport: string,
  league: string,
  home: string,
  away: string
): InventoryEvent {
  return {
    partner: 'fantasy402',
    sport,
    league,
    inventoryId,
    home,
    away,
    feedId: 0,
    donbestId: null,
  };
}

function mockAdapter(events: InventoryEvent[]): FantasySessionAdapter {
  return {
    partnerId: 'fantasy402',
    login: async () => ({ desktop: 'https://x/', mobile: 'https://x/' }),
    fetchInventory: async () => events,
    fetchLimits: async () => ({ maxStake: 0, maxWin: 0 }),
    placeOrder: async () => ({ success: false, error: 'stub' }),
    renewToken: async () => 'tok',
    warmSession: async () => {},
    fetchSports: async () => [],
    getBearerToken: () => 'tok',
    getLiveUrls: () => null,
    fetchBookedEvent: async () => null,
    listBookedEvents: async () => [],
  };
}

describe('inventory leagues', () => {
  test('upsert leagues from events; dry-run does not write', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const events = [
      live('1', 'table_tennis', 'Setka Cup', 'A', 'B'),
      live('2', 'table_tennis', 'Setka Cup', 'C', 'D'),
      live('3', 'cricket', 'Chennai daily cricket', 'E', 'F'),
    ];
    const dry = upsertInventoryLeagues(db, events, { dryRun: true, nowMs: 1000 });
    expect(dry.seen).toBe(2); // Setka + Chennai
    expect(dry.inserted).toBe(2);
    expect(countInventoryLeagues(db).total).toBe(0);

    const liveRes = upsertInventoryLeagues(db, events, { nowMs: 2000 });
    expect(liveRes.inserted).toBe(2);
    const counts = countInventoryLeagues(db);
    expect(counts.total).toBe(2);
    expect(counts.liveNow).toBe(2);

    const setka = listInventoryLeagues(db, { sportId: 'table_tennis' });
    expect(setka.length).toBe(1);
    expect(setka[0]?.leagueKey).toBe('Setka Cup');
    expect(setka[0]?.eventCountLive).toBe(2);
    expect(setka[0]?.peakEventCount).toBe(2);
    expect(setka[0]?.competitionId).toBe('table_tennis.setka_cup');
  });

  test('peak grows; live count zeros when league leaves board', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const a = [live('1', 'table_tennis', 'Setka Cup', 'A', 'B')];
    upsertInventoryLeagues(db, a, { nowMs: 1000 });
    const b = [
      live('1', 'table_tennis', 'Setka Cup', 'A', 'B'),
      live('2', 'table_tennis', 'Setka Cup', 'C', 'D'),
      live('3', 'table_tennis', 'Setka Cup', 'E', 'F'),
    ];
    upsertInventoryLeagues(db, b, { nowMs: 2000 });
    let rows = listInventoryLeagues(db);
    expect(rows[0]?.peakEventCount).toBe(3);
    expect(rows[0]?.eventCountLive).toBe(3);

    // Board empties this league
    upsertInventoryLeagues(db, [], { nowMs: 3000 });
    rows = listInventoryLeagues(db);
    expect(rows[0]?.eventCountLive).toBe(0);
    expect(rows[0]?.peakEventCount).toBe(3);
  });

  test('planInventoryLeagues marks existing after seed', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const events = [live('1', 'table_tennis', 'Setka Cup', 'A', 'B')];
    upsertInventoryLeagues(db, events, { nowMs: 1 });
    const plan = planInventoryLeagues(db, events, { nowMs: 2 });
    expect(plan.inserted).toBe(0);
    expect(plan.updated).toBe(1);
  });

  test('runInventorySync harvests leagues', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const events = [
      live('10', 'table_tennis', 'Setka Cup', 'A', 'B'),
      live('11', 'ice_hockey', 'RHL', 'X', 'Y'),
    ];
    const report = await runInventorySync(db, mockAdapter(events), {
      sport: 'all',
      nowMs: 5000,
    });
    expect(report.leagues.seen).toBe(2);
    expect(report.leagues.inserted).toBe(2);
    expect(countInventoryLeagues(db).total).toBe(2);
  });
});
