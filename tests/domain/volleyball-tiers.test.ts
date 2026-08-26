// @see https://bun.com/docs/test/writing-tests#matchers
import { describe, expect, test } from 'bun:test';
import {
  getCompetition,
  listCompetitionsBySport,
  resolveCompetition,
} from '../../src/domain/index.ts';
import {
  NCAA_VOLLEYBALL_COMPETITION_SEEDS,
  VOLLEYBALL_TIER_BY_COMPETITION_ID,
  inferVolleyballTierFromLeagueLabel,
  listVolleyballCompetitionIdsByTier,
  resolveVolleyballCompetitionTier,
} from '../../src/domain/volleyball-tiers.ts';

describe('volleyball tiers + NCAA seeds', () => {
  test('NCAA seeds are registered and resolve common aliases', () => {
    expect(NCAA_VOLLEYBALL_COMPETITION_SEEDS.length).toBe(10);
    for (const seed of NCAA_VOLLEYBALL_COMPETITION_SEEDS) {
      expect(getCompetition(seed.id)).toBeDefined();
      expect(getCompetition(seed.id)?.sportId).toBe('volleyball');
    }

    const umbrella = resolveCompetition({
      liveProduct: 'plive',
      sportId: 'volleyball',
      inventoryBucket: 'volleyball',
      league: 'NCAA Volleyball',
    });
    expect(umbrella?.competitionId).toBe('volleyball.ncaa_women_s_volleyball');

    const tourney = resolveCompetition({
      liveProduct: 'plive',
      sportId: 'volleyball',
      inventoryBucket: 'volleyball',
      league: "NCAA Women's Volleyball Tournament",
    });
    expect(tourney?.competitionId).toBe(
      'volleyball.ncaa_women_s_volleyball_tournament',
    );

    const bigTen = resolveCompetition({
      liveProduct: 'plive',
      sportId: 'volleyball',
      inventoryBucket: 'volleyball',
      league: "Big Ten Women's Volleyball",
    });
    expect(bigTen?.competitionId).toBe('volleyball.ncaa_big_ten_women');

    const beach = resolveCompetition({
      liveProduct: 'plive',
      sportId: 'volleyball',
      inventoryBucket: 'volleyball',
      league: 'NCAA Beach Volleyball',
    });
    expect(beach?.competitionId).toBe('volleyball.ncaa_beach_volleyball');
  });

  test('tier map covers every seeded volleyball competition id', () => {
    const volleyball = listCompetitionsBySport('volleyball');
    expect(volleyball.length).toBeGreaterThanOrEqual(40);
    for (const c of volleyball) {
      const tier = resolveVolleyballCompetitionTier({
        competitionId: c.id,
        leagueKey: c.displayName,
      });
      expect(tier).toMatch(/^[ABCD]$/);
      // Explicit pin preferred when present
      if (VOLLEYBALL_TIER_BY_COMPETITION_ID[c.id]) {
        expect(tier).toBe(VOLLEYBALL_TIER_BY_COMPETITION_ID[c.id]!);
      }
    }
  });

  test('label heuristics: NCAA Power 4 A, DIII C, SuperLega A, friendly D', () => {
    expect(inferVolleyballTierFromLeagueLabel("NCAA Women's Volleyball")).toBe('A');
    expect(inferVolleyballTierFromLeagueLabel('NCAA Big Ten Volleyball Women')).toBe(
      'A',
    );
    expect(inferVolleyballTierFromLeagueLabel("NCAA DIII Women's Volleyball")).toBe(
      'C',
    );
    expect(inferVolleyballTierFromLeagueLabel("NCAA Men's Volleyball")).toBe('B');
    expect(inferVolleyballTierFromLeagueLabel('Italy SuperLega')).toBe('A');
    expect(inferVolleyballTierFromLeagueLabel('CEV Champions League')).toBe('A');
    expect(inferVolleyballTierFromLeagueLabel('Friendly International')).toBe('D');
    expect(inferVolleyballTierFromLeagueLabel('Beach Pro Tour Elite 16')).toBe('B');
  });

  test('list by tier includes NCAA A comps', () => {
    const a = listVolleyballCompetitionIdsByTier('A');
    expect(a).toContain('volleyball.ncaa_women_s_volleyball');
    expect(a).toContain('volleyball.ncaa_big_ten_women');
    expect(a).toContain('volleyball.international_nations_league_women');
    const d = listVolleyballCompetitionIdsByTier('D');
    expect(d).toContain('volleyball.friendly_international');
  });

  test('resolveVolleyballCompetitionTier prefers id over label', () => {
    expect(
      resolveVolleyballCompetitionTier({
        competitionId: 'volleyball.friendly_international',
        leagueKey: 'NCAA Women Volleyball', // would be A by label alone
      }),
    ).toBe('D');
  });

  test('Indiya country-bucket maps to volleyball.indiya tier D', () => {
    const hit = resolveCompetition({
      liveProduct: 'plive',
      sportId: 'volleyball',
      inventoryBucket: 'volleyball',
      league: 'Indiya',
    });
    expect(hit?.competitionId).toBe('volleyball.indiya');
    expect(
      resolveVolleyballCompetitionTier({
        ...(hit?.competitionId !== undefined ? { competitionId: hit.competitionId } : {}),
      }),
    ).toBe('D');
    expect(inferVolleyballTierFromLeagueLabel('Indiya')).toBe('D');
  });
});
