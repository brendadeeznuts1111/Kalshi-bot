// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  countInventoryLeagues,
  listInventoryLeagues,
  planInventoryLeagues,
  upsertInventoryLeagues,
} from '../../src/inventory/leagues.ts';
import { runInventorySync } from '../../src/inventory/sync.ts';
import { liveEvent, memoryDb, mockFantasyAdapter } from './fixtures.ts';

describe('inventory leagues', () => {
  test('upsert leagues from events; dry-run does not write', () => {
    const db = memoryDb();
    const events = [
      liveEvent('1', 'table_tennis', 'A', 'B', 'Setka Cup'),
      liveEvent('2', 'table_tennis', 'C', 'D', 'Setka Cup'),
      liveEvent('3', 'cricket', 'E', 'F', 'Chennai daily cricket'),
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
    const db = memoryDb();
    const a = [liveEvent('1', 'table_tennis', 'A', 'B', 'Setka Cup')];
    upsertInventoryLeagues(db, a, { nowMs: 1000 });
    const b = [
      liveEvent('1', 'table_tennis', 'A', 'B', 'Setka Cup'),
      liveEvent('2', 'table_tennis', 'C', 'D', 'Setka Cup'),
      liveEvent('3', 'table_tennis', 'E', 'F', 'Setka Cup'),
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
    const db = memoryDb();
    const events = [liveEvent('1', 'table_tennis', 'A', 'B', 'Setka Cup')];
    upsertInventoryLeagues(db, events, { nowMs: 1 });
    const plan = planInventoryLeagues(db, events, { nowMs: 2 });
    expect(plan.inserted).toBe(0);
    expect(plan.updated).toBe(1);
  });

  test('runInventorySync harvests leagues', async () => {
    const db = memoryDb();
    const events = [liveEvent('1', 'table_tennis', 'A', 'B', 'Setka Cup')];
    const report = await runInventorySync(db, mockFantasyAdapter(events), {
      sport: 'table_tennis',
      dryRun: false,
      nowMs: 5000,
    });
    expect(report.seen).toBeGreaterThanOrEqual(1);
    expect(countInventoryLeagues(db).total).toBeGreaterThanOrEqual(1);
  });
});
