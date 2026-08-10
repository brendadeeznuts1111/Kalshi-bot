// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  PANDORA_SPORT_PERIODS,
  bakedPeriodLabel,
  listBakedPeriodFeedSportIds,
  periodUnitForFeedSport,
} from '../../src/domain/pandora-sport-periods.ts';
import {
  countryName,
  listPandoraCountries,
} from '../../src/domain/pandora-countries.ts';
import { parseSportPeriodRoom } from '../../src/domain/widget-domain-extract.ts';

describe('baked pandora sport periods', () => {
  test('covers core board sports with correct units', () => {
    const ids = listBakedPeriodFeedSportIds();
    expect(ids.length).toBeGreaterThanOrEqual(40);
    expect(periodUnitForFeedSport(1)).toBe('Inning');
    expect(periodUnitForFeedSport(2)).toBe('Quarter');
    expect(periodUnitForFeedSport(3)).toBe('Quarter');
    expect(periodUnitForFeedSport(5)).toBe('Half');
    expect(periodUnitForFeedSport(8)).toBe('Set');
    expect(periodUnitForFeedSport(93)).toBe('Game');
    expect(bakedPeriodLabel(93, 's3')).toBe('3rd Game');
    expect(bakedPeriodLabel(1, 's9')).toBe('9th Inning');
    expect(PANDORA_SPORT_PERIODS.language).toBe('en');
  });

  test('parseSportPeriodRoom keeps periodNames units', () => {
    const parsed = parseSportPeriodRoom({
      en: {
        periodNames: { '93': 'Game', '1': 'Inning' },
        periods: {
          '93': { m: 'Match', s1: '1st Game' },
          '1': { m: 'Game', s1: '1st Inning' },
        },
        abbreviations: { Inning: 'Inn' },
      },
    });
    expect(parsed?.primary?.periodUnit?.['93']).toBe('Game');
    expect(parsed?.primary?.bySport['1']?.s1).toBe('1st Inning');
    expect(parsed?.primary?.abbreviations?.Inning).toBe('Inn');
  });
});

describe('baked pandora countries', () => {
  test('resolves common country ids', () => {
    expect(listPandoraCountries().length).toBeGreaterThan(100);
    expect(countryName(2)).toBe('United States');
    expect(countryName(4)).toBe('International');
    expect(countryName(0)).toBe('others');
    expect(countryName(999999)).toBeNull();
  });
});
