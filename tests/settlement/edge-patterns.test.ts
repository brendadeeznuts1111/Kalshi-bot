// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  EDGE_PATTERN_FAMILIES,
  edgePatternsByFamily,
  getEdgePattern,
  lineKindFromMarketClass,
  listEdgePatterns,
  parseEdgePatternSortBy,
  scanEdgePatterns,
  sortEdgePatternHits,
  sortEdgePatterns,
  weightLiveTrackerMove,
} from '../../src/settlement/index.ts';

describe('edge pattern catalog', () => {
  test('every family has ≥1 pattern', () => {
    const by = edgePatternsByFamily();
    for (const f of EDGE_PATTERN_FAMILIES) {
      expect(by[f].length).toBeGreaterThan(0);
    }
  });

  test('pattern ids unique and family.slug shaped', () => {
    const ids = listEdgePatterns().map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of listEdgePatterns()) {
      expect(p.id.startsWith(p.family.split('_')[0]! ) || p.id.includes('.')).toBe(true);
      expect(getEdgePattern(p.id)?.title).toBeTruthy();
    }
  });

  test('lineKindFromMarketClass', () => {
    expect(lineKindFromMarketClass('match_ml')).toBe('moneyline');
    expect(lineKindFromMarketClass('total')).toBe('total');
    expect(lineKindFromMarketClass('set_market')).toBe('prop');
  });
});

describe('scanEdgePatterns sport-wide', () => {
  test('live tennis unfinished ML → void + phase + prefer unit patterns', () => {
    const scan = scanEdgePatterns({
      sportId: 'tennis',
      phase: 'live',
      marketType: '3',
      period: 'm',
      matchState: { matchCompleted: false },
    });
    const ids = scan.hits.map(h => h.patternId);
    expect(ids).toContain('void.live-ml-unfinished');
    expect(scan.maxSeverity === 'high' || scan.maxSeverity === 'critical').toBe(true);
    expect(scan.components.pat_hit_count).toBeGreaterThan(0);
    expect(scan.eyeOpeners.some(e => e.includes('void.live-ml-unfinished'))).toBe(true);
  });

  test('injury + live tennis ML → critical injury-steam pattern', () => {
    const scan = scanEdgePatterns({
      sportId: 'tennis',
      phase: 'live',
      marketType: '3',
      period: 'm',
      matchState: { matchCompleted: false, injuryRisk: true },
    });
    expect(scan.hits.some(h => h.patternId === 'void.injury-steam-vs-void')).toBe(true);
    expect(scan.maxSeverity).toBe('critical');
  });

  test('basketball Q4 total → OT exclusion pattern', () => {
    const scan = scanEdgePatterns({
      sportId: 'basketball',
      phase: 'live',
      marketType: '5',
      period: 'q4',
    });
    expect(scan.hits.some(h => h.patternId === 'period.ot-inclusion-mismatch')).toBe(true);
    expect(
      scan.hits.find(h => h.patternId === 'period.ot-inclusion-mismatch')?.severity,
    ).toBe('high');
  });

  test('baseball eligibility broken → critical', () => {
    const scan = scanEdgePatterns({
      sportId: 'baseball',
      phase: 'prematch',
      marketType: '3',
      period: 'm',
      matchState: { eligibilityBroken: true },
    });
    expect(scan.hits.some(h => h.patternId === 'elig.listed-pitcher-or-must-play')).toBe(true);
    expect(scan.maxSeverity).toBe('critical');
  });

  test('completed set market → unit survives info', () => {
    const scan = scanEdgePatterns({
      sportId: 'tennis',
      phase: 'live',
      marketType: '16',
      period: 's1',
      matchState: { periodCompleted: true },
    });
    expect(scan.hits.some(h => h.patternId === 'void.completed-unit-survives')).toBe(true);
  });

  test('soccer total → interrupt / line unit families present', () => {
    const scan = scanEdgePatterns({
      sportId: 'soccer',
      phase: 'prematch',
      marketType: '5',
      period: 'm',
    });
    const families = new Set(scan.hits.map(h => h.family));
    expect(families.has('interrupt_window') || families.has('line_unit')).toBe(true);
  });

  test('weightLiveTrackerMove includes patterns', () => {
    const r = weightLiveTrackerMove({
      sportId: 'tennis',
      phase: 'live',
      marketType: '3',
      period: 'm',
      decimalOdds: 1.8,
      matchState: { injuryRisk: true, matchCompleted: false },
    });
    expect(r.patterns.length).toBeGreaterThan(0);
    expect(r.eyeOpeners.length).toBeGreaterThan(0);
    expect(r.pVoidPrior).toBeGreaterThanOrEqual(0.15);
  });
});

describe('edge pattern --sort-by family|severity|id', () => {
  test('parseEdgePatternSortBy', () => {
    expect(parseEdgePatternSortBy(undefined)).toEqual(['family', 'id']);
    expect(parseEdgePatternSortBy('severity,id')).toEqual(['severity', 'id']);
    expect(parseEdgePatternSortBy('id')).toEqual(['id']);
    expect(parseEdgePatternSortBy('nope,family,time')).toEqual(['family']);
    expect(parseEdgePatternSortBy('bogus', ['severity', 'id'])).toEqual(['severity', 'id']);
  });

  test('sortEdgePatterns by id', () => {
    const sorted = sortEdgePatterns(listEdgePatterns(), { sortBy: ['id'] });
    const ids = sorted.map(p => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  test('sortEdgePatterns by family then id', () => {
    const sorted = sortEdgePatterns(listEdgePatterns(), { sortBy: ['family', 'id'] });
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.family === cur.family) {
        expect(prev.id.localeCompare(cur.id)).toBeLessThanOrEqual(0);
      }
    }
  });

  test('sortEdgePatternHits severity first', () => {
    const scan = scanEdgePatterns({
      sportId: 'tennis',
      phase: 'live',
      marketType: '3',
      period: 'm',
      matchState: { injuryRisk: true, matchCompleted: false },
    });
    const bySev = sortEdgePatternHits(scan.hits, { sortBy: ['severity', 'id'] });
    const rank = (s: string) =>
      s === 'critical' ? 4 : s === 'high' ? 3 : s === 'watch' ? 2 : 1;
    for (let i = 1; i < bySev.length; i++) {
      expect(rank(bySev[i - 1]!.severity)).toBeGreaterThanOrEqual(rank(bySev[i]!.severity));
    }
  });

  test('sortEdgePatternHits by family', () => {
    const scan = scanEdgePatterns(
      {
        sportId: 'tennis',
        phase: 'live',
        marketType: '3',
        period: 'm',
        matchState: { matchCompleted: false },
      },
      { sortBy: ['family', 'id'] },
    );
    const families = scan.hits.map(h => h.family);
    expect(families).toEqual([...families].sort((a, b) => a.localeCompare(b)));
  });

  test('scanEdgePatterns respects sort option', () => {
    const byId = scanEdgePatterns(
      {
        sportId: 'basketball',
        phase: 'live',
        marketType: '5',
        period: 'q4',
      },
      { sortBy: ['id'] },
    );
    const ids = byId.hits.map(h => h.patternId);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});
