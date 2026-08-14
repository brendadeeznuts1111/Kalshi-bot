// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  applyInventoryLeagueResolve,
  planInventoryLeagueResolve,
  scoreLeagueAgainstCompetition,
  stripLeagueNoise,
} from '../../src/inventory/league-resolve.ts';
import {
  listInventoryLeagues,
  upsertInventoryLeagues,
} from '../../src/inventory/leagues.ts';
import { liveEvent, memoryDb } from './fixtures.ts';
import { getCompetition } from '../../src/domain/competitions.ts';

describe('league-resolve (Map lane)', () => {
  test('stripLeagueNoise drops circuit tokens', () => {
    expect(stripLeagueNoise('ATP - Cincinnati')).toContain('cincinnati');
    expect(stripLeagueNoise('ATP - Cincinnati')).not.toMatch(/\batp\b/);
  });

  test('score exact Setka Cup is 1.0', () => {
    const setka = getCompetition('table_tennis.setka_cup');
    expect(setka).toBeTruthy();
    const s = scoreLeagueAgainstCompetition('Setka Cup', setka!);
    expect(s.confidence).toBe(1);
    expect(s.matchKind).toBe('exact');
  });

  test('plan resolves unmapped Setka after clearing competition_id', () => {
    const db = memoryDb();
    upsertInventoryLeagues(
      db,
      [liveEvent('1', 'table_tennis', 'A', 'B', 'Setka Cup')],
      { nowMs: 1000 }
    );
    // Force unmapped (simulate missing stamp)
    db.run(
      `UPDATE inventory_leagues SET competition_id = NULL WHERE league_key_norm LIKE '%setka%'`
    );
    expect(
      listInventoryLeagues(db, { unmappedOnly: true }).some(
        r => r.leagueKey === 'Setka Cup'
      )
    ).toBe(true);

    const plan = planInventoryLeagueResolve(db, {
      sport: 'table_tennis',
      threshold: 0.9,
    });
    expect(plan.unmappedInput).toBeGreaterThanOrEqual(1);
    const hit = plan.autoApply.find(s => s.leagueKey === 'Setka Cup');
    expect(hit?.suggestedCompetitionId).toBe('table_tennis.setka_cup');
    expect(hit?.confidence).toBe(1);
    expect(hit?.matchKind).toBe('exact');

    const n = applyInventoryLeagueResolve(db, plan.autoApply);
    expect(n).toBeGreaterThanOrEqual(1);
    const after = listInventoryLeagues(db, { sportId: 'table_tennis' });
    expect(after.find(r => r.leagueKey === 'Setka Cup')?.competitionId).toBe(
      'table_tennis.setka_cup'
    );
  });

  test('fuzzy scores stay below default auto-apply threshold', () => {
    const setka = getCompetition('table_tennis.setka_cup');
    expect(setka).toBeTruthy();
    // related label but not exact — should not be 1.0
    const s = scoreLeagueAgainstCompetition('Setka Super Cup Extra', setka!);
    if (s.confidence > 0) {
      expect(s.confidence).toBeLessThan(0.9);
      expect(s.matchKind === 'fuzzy' || s.matchKind === 'normalized').toBe(true);
    }
  });

  test('containment and short labels do not auto-apply at 0.9', () => {
    const setka = getCompetition('table_tennis.setka_cup');
    expect(setka).toBeTruthy();
    // "Setka" alone must not stamp setka_cup at ≥0.9
    const short = scoreLeagueAgainstCompetition('Setka', setka!);
    expect(short.confidence).toBeLessThan(0.9);

    const cup = getCompetition('basketball.chile_lnb_cup');
    if (cup) {
      const lnb = scoreLeagueAgainstCompetition('Chile LNB', cup);
      expect(lnb.confidence).toBeLessThan(0.9);
    }
  });
});
