// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  applyCompetitionRecordsToSource,
  formatCompetitionRecordSource,
  isPromotableLeagueLabel,
  junkLeagueReason,
  mintCompetitionId,
  planCompetitionPromote,
} from '../../src/domain/competition-promote.ts';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import {
  stampInventoryLeaguesFromRecords,
  upsertInventoryLeagues,
} from '../../src/inventory/leagues.ts';
import type { InventoryEvent } from '../../src/partner/types.ts';

describe('competition promote', () => {
  test('junkLeagueReason rejects matchups and person initials', () => {
    expect(junkLeagueReason('Vitaliy S')).toBe('person_initial');
    expect(junkLeagueReason('A')).toBe('too_short');
    expect(
      junkLeagueReason(
        'evenkiyskiy avtonomniy hoshun - Orochonskiy avtonomniy hoshun'
      )
    ).toBe('matchup_blob');
    expect(junkLeagueReason('Universitet Thonburi - Universitet Thammasat')).toBe(
      'matchup_blob'
    );
    // Opaque single-token product / nicknames stay junk
    expect(junkLeagueReason('FrostBall')).toBe('no_structure');
    expect(junkLeagueReason('Subhockey')).toBe('no_structure');
    // Feed country buckets (RU translit) are promotable
    expect(junkLeagueReason('Filippini')).toBeNull();
    expect(junkLeagueReason('Niderlandi')).toBeNull();
    expect(junkLeagueReason('Rossiya')).toBeNull();
    // ITF weekly labels look like matchups but are tournaments
    expect(junkLeagueReason('W35 Aldershot - 9 August 26')).toBeNull();
    expect(junkLeagueReason('M25 Muttenz - 9 August 26')).toBeNull();
    expect(isPromotableLeagueLabel('Setka Cup')).toBe(true);
    expect(isPromotableLeagueLabel('Angola. Liga Bantu')).toBe(true);
    expect(isPromotableLeagueLabel('China Open 2026 - 2026/2027')).toBe(true);
    expect(isPromotableLeagueLabel('IPBL. Prime Division')).toBe(true);
    // Circuit / translit markers
    expect(isPromotableLeagueLabel('ATT. Saransk')).toBe(true);
    expect(isPromotableLeagueLabel('CAGE')).toBe(true);
    expect(isPromotableLeagueLabel('Evropeyskaya seriya')).toBe(true);
    expect(isPromotableLeagueLabel('Indoor Series')).toBe(true);
    expect(isPromotableLeagueLabel('Kvalifikatsiya')).toBe(true);
  });

  test('mintCompetitionId + plan skips already-seeded; inserts novel', () => {
    expect(mintCompetitionId('table_tennis', 'Setka Cup')).toBe(
      'table_tennis.setka_cup'
    );
    const plan = planCompetitionPromote([
      {
        sportId: 'table_tennis',
        leagueKey: 'Setka Cup',
        inventoryBucket: 'table_tennis',
        peakEventCount: 5,
      },
      {
        sportId: 'basketball',
        leagueKey: 'FactoryWager Test Premier League',
        inventoryBucket: 'basketball',
        peakEventCount: 2,
      },
      {
        sportId: 'soccer',
        leagueKey: 'Team A - Team B',
        inventoryBucket: 'football',
        peakEventCount: 1,
      },
    ]);
    expect(plan.rejected.some(r => r.reason === 'already_mapped')).toBe(true);
    expect(plan.rejected.some(r => r.reason === 'matchup_blob')).toBe(true);
    expect(
      plan.toInsert.some(r => r.id === 'basketball.factorywager_test_premier_league')
    ).toBe(true);
    expect(plan.toInsert[0]?.providerMappings.plive?.inventoryBucket).toBe(
      'basketball'
    );
  });

  test('minPeak filters', () => {
    const plan = planCompetitionPromote(
      [
        {
          sportId: 'soccer',
          leagueKey: 'Angola. Liga Bantu',
          inventoryBucket: 'football',
          peakEventCount: 1,
        },
      ],
      { minPeak: 2 }
    );
    expect(plan.toInsert.length).toBe(0);
    expect(plan.rejected[0]?.reason).toBe('below_min_peak');
  });

  test('applyCompetitionRecordsToSource inserts before as const', () => {
    const stub = `export const COMPETITIONS = [
  {
    id: 'table_tennis.setka_cup',
    sportId: 'table_tennis',
    displayName: 'Setka Cup',
    aliases: ['Setka Cup'],
    gender: 'unknown',
    providerMappings: { plive: { inventoryBucket: 'table_tennis', leagueKey: 'Setka Cup' } },
  },
] as const satisfies readonly CompetitionRecord[];
`;
    const rec = {
      id: 'basketball.ipbl_prime_division',
      sportId: 'basketball' as const,
      displayName: 'IPBL. Prime Division',
      aliases: ['IPBL. Prime Division'],
      gender: 'unknown' as const,
      providerMappings: {
        plive: { inventoryBucket: 'basketball', leagueKey: 'IPBL. Prime Division' },
      },
    };
    const { next, added, skipped } = applyCompetitionRecordsToSource(stub, [rec]);
    expect(added).toEqual(['basketball.ipbl_prime_division']);
    expect(skipped).toEqual([]);
    expect(next).toContain("id: \"basketball.ipbl_prime_division\"");
    expect(next.indexOf('basketball.ipbl_prime_division')).toBeLessThan(
      next.indexOf('] as const')
    );
    const again = applyCompetitionRecordsToSource(next, [rec]);
    expect(again.added).toEqual([]);
    expect(again.skipped).toEqual(['basketball.ipbl_prime_division']);
  });

  test('formatCompetitionRecordSource is parseable-ish', () => {
    const src = formatCompetitionRecordSource({
      id: 'soccer.angola_liga_bantu',
      sportId: 'soccer',
      displayName: 'Angola. Liga Bantu',
      aliases: ['Angola. Liga Bantu'],
      gender: 'unknown',
      providerMappings: {
        plive: { inventoryBucket: 'football', leagueKey: 'Angola. Liga Bantu' },
      },
    });
    expect(src).toContain('soccer.angola_liga_bantu');
    expect(src).toContain('football');
  });

  test('stampInventoryLeaguesFromRecords after upsert', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const events: InventoryEvent[] = [
      {
        partner: 'fantasy402',
        sport: 'basketball',
        league: 'IPBL. Prime Division',
        inventoryId: '1',
        home: 'A',
        away: 'B',
        feedId: 0,
        donbestId: null,
      },
    ];
    upsertInventoryLeagues(db, events, { nowMs: 1 });
    const n = stampInventoryLeaguesFromRecords(db, [
      {
        id: 'basketball.ipbl_prime_division',
        sportId: 'basketball',
        providerMappings: {
          plive: {
            inventoryBucket: 'basketball',
            leagueKey: 'IPBL. Prime Division',
          },
        },
      },
    ]);
    expect(n).toBe(1);
  });
});
