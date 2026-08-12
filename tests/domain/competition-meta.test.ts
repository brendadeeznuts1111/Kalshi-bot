// @see https://bun.com/docs/test/writing-tests#matchers
import { describe, expect, test } from 'bun:test';
import {
  competitionRecordFromLeague,
  getCompetition,
  getCompetitionMetaById,
  inferCompetitionCountryCode,
  inferCompetitionKind,
  resolveCompetitionMeta,
} from '../../src/domain/index.ts';

describe('competition country + kind meta', () => {
  test('infer country from country bucket, leading Country., NCAA, INT', () => {
    expect(inferCompetitionCountryCode('Indiya')).toBe('IN');
    expect(inferCompetitionCountryCode('Rossiya')).toBe('RU');
    expect(inferCompetitionCountryCode('Niderlandi')).toBe('NL');
    expect(inferCompetitionCountryCode('India. Milad Cup')).toBe('IN');
    expect(inferCompetitionCountryCode('South Africa. Fairview')).toBe('ZA');
    expect(inferCompetitionCountryCode('Russia. League Pro. Women')).toBe('RU');
    expect(inferCompetitionCountryCode("NCAA Women's Volleyball")).toBe('US');
    expect(inferCompetitionCountryCode('International Nations League - Women')).toBe(
      'INT',
    );
    expect(inferCompetitionCountryCode('Club Friendlies')).toBe('INT');
    expect(inferCompetitionCountryCode('W35 Aldershot - 9 August 26')).toBeNull();
  });

  test('infer kind: country_bucket, itf_week, league, cup, friendly, circuit', () => {
    expect(inferCompetitionKind('Indiya')).toBe('country_bucket');
    expect(inferCompetitionKind('W35 Aldershot - 9 August 26')).toBe('itf_week');
    expect(inferCompetitionKind('Belarus. Liga Pro')).toBe('league');
    expect(inferCompetitionKind('Ghana Super Cup. Division 1')).toBe('cup');
    expect(inferCompetitionKind('Club Friendlies')).toBe('friendly');
    expect(inferCompetitionKind('ATP Challenger Todi, Italy Men Singles')).toBe(
      'circuit',
    );
    expect(inferCompetitionKind('ATT. Moscow. Women')).toBe('circuit');
    expect(inferCompetitionKind('FrostBall')).toBe('product');
  });

  test('promote writes countryCode + kind on new records', () => {
    const rec = competitionRecordFromLeague({
      sportId: 'volleyball',
      leagueKey: 'Indiya',
      inventoryBucket: 'volleyball',
    });
    expect(rec).not.toBeNull();
    expect(rec!.countryCode).toBe('IN');
    expect(rec!.kind).toBe('country_bucket');

    const itf = competitionRecordFromLeague({
      sportId: 'tennis',
      leagueKey: 'M25 Muttenz - 9 August 26',
      inventoryBucket: 'tennis',
    });
    expect(itf!.kind).toBe('itf_week');
    expect(itf!.countryCode == null || itf!.countryCode === undefined).toBe(true);
  });

  test('resolveCompetitionMeta infers for legacy seeds without stored fields', () => {
    const russia = getCompetition('volleyball.russia_league_pro_women');
    expect(russia).toBeDefined();
    const meta = resolveCompetitionMeta(russia!);
    expect(meta.countryCode).toBe('RU');
    expect(meta.kind).toBe('league');
    expect(meta.inferred).toBe(true);

    const ncaa = getCompetitionMetaById('volleyball.ncaa_women_s_volleyball');
    expect(ncaa?.countryCode).toBe('US');
    expect(ncaa?.kind).toBe('league'); // DI season umbrella
    const tourney = getCompetitionMetaById(
      'volleyball.ncaa_women_s_volleyball_tournament',
    );
    expect(tourney?.kind).toBe('tournament');
  });

  test('explicit fields win over inference', () => {
    const meta = resolveCompetitionMeta({
      sportId: 'volleyball',
      displayName: 'Indiya',
      countryCode: 'XX',
      kind: 'product',
      providerMappings: {
        plive: { inventoryBucket: 'volleyball', leagueKey: 'Indiya' },
      },
    });
    expect(meta.countryCode).toBe('XX');
    expect(meta.kind).toBe('product');
    expect(meta.inferred).toBe(false);
  });
});
