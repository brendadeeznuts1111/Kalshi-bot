// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  getCompetition,
  inferGenderFromLeagueLabel,
  isCompetitionId,
  listCompetitions,
  listCompetitionsBySport,
  normalizeLeagueKey,
} from '../../src/domain/competitions.ts';
import { resolveCompetition } from '../../src/domain/resolve-competition.ts';

describe('competitions registry', () => {
  test('seeds Setka Cup and Masters Poland Women distinctly', () => {
    expect(getCompetition('table_tennis.setka_cup')?.displayName).toBe('Setka Cup');
    expect(getCompetition('table_tennis.masters_poland')?.gender).toBe('unknown');
    expect(getCompetition('table_tennis.masters_poland_women')?.gender).toBe('women');
    expect(isCompetitionId('table_tennis.setka_cup')).toBe(true);
    expect(isCompetitionId('table_tennis.not_a_league')).toBe(false);
    expect(listCompetitions().length).toBeGreaterThanOrEqual(35);
    expect(listCompetitionsBySport('table_tennis').length).toBeGreaterThanOrEqual(9);
  });

  test('normalizeLeagueKey + inferGenderFromLeagueLabel', () => {
    expect(normalizeLeagueKey('  Setka   Cup ')).toBe('setka cup');
    expect(inferGenderFromLeagueLabel('Masters. Poland. Women')).toBe('women');
    expect(inferGenderFromLeagueLabel('Setka Cup')).toBe('unknown');
  });

  test('resolveCompetition maps plive bucket+league', () => {
    const hit = resolveCompetition({
      liveProduct: 'plive',
      sportId: 'table_tennis',
      league: 'Setka Cup',
    });
    expect(hit?.competitionId).toBe('table_tennis.setka_cup');
    expect(hit?.mappingLiveProduct).toBe('plive');
  });

  test('resolveCompetition maps Masters. Poland. Women with gender', () => {
    const hit = resolveCompetition({
      liveProduct: 'plive',
      inventoryBucket: 'table_tennis',
      league: 'Masters. Poland. Women',
    });
    expect(hit?.competitionId).toBe('table_tennis.masters_poland_women');
    expect(hit?.competition.gender).toBe('women');
    const men = resolveCompetition({
      liveProduct: 'plive',
      inventoryBucket: 'table_tennis',
      league: 'Masters. Poland',
    });
    expect(men?.competitionId).toBe('table_tennis.masters_poland');
  });

  test('ezlive falls back to plive shell mappings', () => {
    const hit = resolveCompetition({
      liveProduct: 'ezlive',
      sportId: 'soccer',
      league: 'USA MPL',
    });
    expect(hit?.competitionId).toBe('soccer.usa_mpl');
    expect(hit?.liveProduct).toBe('ezlive');
    expect(hit?.mappingLiveProduct).toBe('plive');
    expect(hit?.competition.providerMappings.plive?.inventoryBucket).toBe('football');
  });

  test('unknown and junk leagues do not resolve', () => {
    expect(
      resolveCompetition({
        liveProduct: 'plive',
        sportId: 'table_tennis',
        league: 'Vitaliy S',
      })
    ).toBeUndefined();
    expect(
      resolveCompetition({
        liveProduct: 'plive',
        sportId: 'soccer',
        league: 'A',
      })
    ).toBeUndefined();
    expect(
      resolveCompetition({
        liveProduct: 'plive',
        sportId: 'soccer',
        league: 'evenkiyskiy avtonomniy hoshun - Orochonskiy avtonomniy hoshun',
      })
    ).toBeUndefined();
    expect(
      resolveCompetition({
        liveProduct: 'ultralive',
        sportId: 'table_tennis',
        league: 'Setka Cup',
      })
    ).toBeUndefined();
  });
});
