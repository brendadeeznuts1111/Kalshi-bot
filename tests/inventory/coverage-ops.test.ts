// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from 'bun:test';
import {
  buildCoverageOpsReport,
  coverageOpsAlertLines,
  formatCoverageOpsSummary,
} from '../../src/inventory/coverage-ops.ts';

describe('coverage-ops', () => {
  test('buildCoverageOpsReport metrics + gates', () => {
    const r = buildCoverageOpsReport({
      bookId: 'fantasy402',
      eventRows: [
        { sport: 'table_tennis', n: 10, linked: 4 },
        { sport: 'tennis', n: 2, linked: 2 },
      ],
      leagueRows: [
        { sport: 'table_tennis', n: 5, mapped: 2 },
        { sport: 'tennis', n: 1, mapped: 1 },
      ],
      topUnmapped: [
        { sport: 'table_tennis', league: 'Junk Cup', peak: 9, live: 2 },
      ],
      sampleLinked: [],
      leaguesLiveNow: 3,
      gates: { minLinkedPct: 50, maxUnmappedLeagues: 2 },
      nowMs: Date.parse('2026-08-10T12:00:00.000Z'),
    });

    expect(r.odds.total).toBe(12);
    expect(r.odds.linked).toBe(6);
    expect(r.odds.linkedPct).toBe(50);
    expect(r.leagues.unmapped).toBe(3); // 6-3 mapped
    expect(r.quality.passed).toBe(false); // unmapped 3 >= 2
    expect(r.sports).toContain('table_tennis');

    const text = formatCoverageOpsSummary(r);
    expect(text).toContain('coverage-ops FAIL');
    expect(text).toContain('linked=');

    const alerts = coverageOpsAlertLines(r);
    expect(alerts.some(l => l.includes('FAIL') || l.includes('unmapped'))).toBe(
      true
    );
  });

  test('passes when gates satisfied', () => {
    const r = buildCoverageOpsReport({
      eventRows: [{ sport: 'tennis', n: 4, linked: 4 }],
      leagueRows: [{ sport: 'tennis', n: 2, mapped: 2 }],
      topUnmapped: [],
      sampleLinked: [],
      gates: { minLinkedPct: 50, maxUnmappedLeagues: 5 },
    });
    expect(r.quality.passed).toBe(true);
    expect(r.odds.linkedPct).toBe(100);
  });
});
