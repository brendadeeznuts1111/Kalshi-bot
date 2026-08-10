// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  diagnoseBookedMatch,
  matchBookedOddsEventId,
} from '../../src/inventory/booked-match.ts';
import {
  buildEnrichQualityReport,
  formatEnrichQuality,
} from '../../src/inventory/enrich-quality.ts';

const catalog = [
  {
    oddsEventId: '111',
    name: 'Andrey Martinyuk - Aleksandr Timofeev',
    sportName: 'Table Tennis',
  },
  {
    oddsEventId: '222',
    name: 'Sidharth Rawat - Shunsuke Mitsui',
    sportName: 'Tennis',
  },
];

describe('enrich quality loop', () => {
  test('diagnoseBookedMatch returns matched score', () => {
    const d = diagnoseBookedMatch(
      'Andrey Martinyuk',
      'Aleksandr Timofeev',
      catalog,
      { sport: 'table_tennis' }
    );
    expect(d.reason).toBe('matched');
    expect(d.oddsEventId).toBe('111');
    expect(d.score).toBeGreaterThanOrEqual(65);
    expect(matchBookedOddsEventId('Andrey Martinyuk', 'Aleksandr Timofeev', catalog, {
      sport: 'table_tennis',
    })).toBe('111');
  });

  test('diagnoseBookedMatch sport_empty when catalog has no sport', () => {
    const d = diagnoseBookedMatch('A', 'B', catalog, { sport: 'snooker' });
    expect(d.reason).toBe('sport_empty');
    expect(d.oddsEventId).toBeNull();
  });

  test('buildEnrichQualityReport match rate + miss sample + gates', () => {
    const candidates = [
      {
        inventoryId: '1',
        home: 'Andrey Martinyuk',
        away: 'Aleksandr Timofeev',
        sport: 'table_tennis',
        league: null,
      },
      {
        inventoryId: '2',
        home: 'Nobody',
        away: 'Nowhere',
        sport: 'table_tennis',
        league: null,
      },
      {
        inventoryId: '3',
        home: null,
        away: 'X',
        sport: 'table_tennis',
        league: null,
      },
    ];
    const q = buildEnrichQualityReport(candidates, catalog, {
      linkedPct: 50,
      gates: { minMatchRate: 0.5, minLinkedPct: 40 },
    });
    expect(q.matched).toBe(1);
    expect(q.candidates).toBe(3);
    expect(q.matchRate).toBeCloseTo(1 / 3, 5);
    expect(q.byReason.matched).toBe(1);
    expect(q.byReason.missing_names).toBe(1);
    expect(q.passed).toBe(false); // matchRate 33% < 50%
    expect(q.errors.some(e => e.includes('matchRate'))).toBe(true);

    const ok = buildEnrichQualityReport(candidates, catalog, {
      linkedPct: 50,
      gates: { minMatchRate: 0.3, minLinkedPct: 40 },
    });
    expect(ok.passed).toBe(true);

    const text = formatEnrichQuality(q);
    expect(text).toContain('enrich-quality FAIL');
    expect(text).toContain('reasons:');
  });
});
