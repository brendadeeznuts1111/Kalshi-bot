// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { memoryDb } from './fixtures.ts';
import { upsertInventoryLeagues } from '../../src/inventory/leagues.ts';
import { buildPromoteReport } from '../../src/inventory/promote-report.ts';
import type { InventoryEvent } from '../../src/partner/types.ts';

function live(
  inventoryId: string,
  sport: string,
  league: string
): InventoryEvent {
  return {
    partner: 'fantasy402',
    sport,
    league,
    inventoryId,
    home: 'A',
    away: 'B',
    feedId: 0,
    donbestId: null,
  };
}

describe('promote-report', () => {
  test('buildPromoteReport surfaces candidates and summaryLine', () => {
    const db = memoryDb();
    upsertInventoryLeagues(
      db,
      [
        live('1', 'tennis', 'ATT. Test City Cup'),
        live('2', 'soccer', 'Team X - Team Y'),
        live('3', 'table_tennis', 'Setka Cup'), // already seeded
      ],
      { nowMs: 1000 }
    );

    const report = buildPromoteReport(db, { minPeak: 1 });
    expect(report.unmappedInput).toBeGreaterThanOrEqual(2);
    expect(report.plan.candidates.some(c => c.record.id.includes('att_test'))).toBe(
      true
    );
    expect(report.plan.rejected.some(r => r.reason === 'matchup_blob')).toBe(true);
    expect(report.summaryLine).toContain('promote-report');
    expect(report.summaryLine).toContain('candidates=');
    expect(report.detailLines.some(l => l.includes('+C'))).toBe(true);
  });

  test('minPeak filters candidates', () => {
    const db = memoryDb();
    upsertInventoryLeagues(db, [live('1', 'tennis', 'ATT. Lonely Peak')], {
      nowMs: 1,
    });
    const report = buildPromoteReport(db, { minPeak: 5 });
    expect(report.plan.candidates.length).toBe(0);
    expect(report.plan.rejected.some(r => r.reason === 'below_min_peak')).toBe(true);
  });
});
