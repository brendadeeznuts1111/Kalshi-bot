// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import { memoryDb } from './fixtures.ts';
import {
  ensureInventoryLeaguesSchema,
  upsertInventoryLeagues,
} from '../../src/inventory/leagues.ts';
import { buildPromoteReport } from '../../src/inventory/promote-report.ts';
import { normalizeLeagueKey } from '../../src/domain/competitions.ts';
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
        live('3', 'table_tennis', 'Setka Cup'), // already seeded
      ],
      { nowMs: 1000 }
    );

    // Legacy junk row predating the upsert junk filter (855b654) — must still
    // surface in the report as a matchup_blob rejection, never a candidate.
    ensureInventoryLeaguesSchema(db);
    const legacySql = [
      'INSERT INTO inventory_leagues (',
      '  book_id, inventory_bucket, sport_id, league_key, league_key_norm,',
      '  competition_id, event_count_live, peak_event_count,',
      '  first_seen, last_seen, sample_home, sample_away',
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ].join('\n');
    db.query(legacySql).run(
      'fantasy402',
      'football', // soccer → football wire bucket
      'soccer',
      'Team X - Team Y',
      normalizeLeagueKey('Team X - Team Y'),
      null,
      1,
      1,
      1000,
      1000,
      'X',
      'Y'
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
