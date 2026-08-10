// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  inventoryFromStreamList,
  staticSportMapSummary,
} from '../../src/inventory/sports-inventory.ts';

describe('sports-inventory', () => {
  test('inventoryFromStreamList empty / bad wire', () => {
    const empty = inventoryFromStreamList(null, { url: 'https://x/stream' });
    expect(empty.sportBuckets).toBe(0);
    expect(empty.totalEvents).toBe(0);
    expect(empty.url).toBe('https://x/stream');
    expect(empty.rows).toEqual([]);
    expect(empty.mapOnlyBuckets.length).toBeGreaterThan(0);

    const emptyObj = inventoryFromStreamList({}, { url: 'u' });
    expect(emptyObj.sportBuckets).toBe(0);
  });

  test('inventoryFromStreamList aggregates leagues and maps known buckets', () => {
    const inv = inventoryFromStreamList(
      {
        sports: {
          table_tennis: {
            count: 2,
            events: {
              a: { sport: 'Table Tennis', league: 'Setka Cup' },
              b: { sport: 'Table Tennis', league: 'Setka Cup' },
              c: { sport: 'Table Tennis', league: 'Other' },
            },
          },
          mystery_sport: {
            events: [{ sport: 'Mystery', league: 'X' }],
          },
        },
      },
      { url: 'https://example/stream-list' }
    );

    expect(inv.sportBuckets).toBe(2);
    expect(inv.totalEvents).toBe(3); // count:2 wins for TT; mystery uses events.length=1
    expect(inv.unmappedBuckets).toContain('mystery_sport');
    expect(inv.mappedBuckets).toBe(1);

    const tt = inv.rows.find(r => r.streamBucket === 'table_tennis');
    expect(tt).toBeDefined();
    expect(tt!.mapped).toBe(true);
    expect(tt!.eventCount).toBe(2);
    expect(tt!.leagueCount).toBe(2);
    expect(tt!.leagues[0]!.league).toBe('Setka Cup');
    expect(tt!.leagues[0]!.eventCount).toBe(2);
    expect(tt!.sampleSportLabel).toBe('Table Tennis');

    const mystery = inv.rows.find(r => r.streamBucket === 'mystery_sport');
    expect(mystery!.mapped).toBe(false);
    expect(mystery!.eventCount).toBe(1);
  });

  test('staticSportMapSummary counts mappings', () => {
    const s = staticSportMapSummary();
    expect(s.total).toBeGreaterThan(0);
    expect(s.buckets).toContain('table_tennis');
    expect(s.primary).toBeGreaterThan(0);
    expect(s.withFeedId).toBeGreaterThan(0);
  });
});
