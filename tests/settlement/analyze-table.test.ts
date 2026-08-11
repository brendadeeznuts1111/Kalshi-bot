// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  ANALYZE_WEIGHTED_ALL_COLUMNS,
  ANALYZE_WEIGHTED_FIELD_SCHEMA,
  buildAnalyzeSnapshotArtifact,
  flattenWeightedEventRow,
  formatAnalyzeInspectTable,
  formatAnalyzeMarkdownTable,
  weightLiveTrackerMove,
} from '../../src/settlement/index.ts';

describe('analyze weighted table schema', () => {
  test('schema lists all flat fields', () => {
    expect(ANALYZE_WEIGHTED_FIELD_SCHEMA.length).toBeGreaterThan(20);
    expect([...ANALYZE_WEIGHTED_ALL_COLUMNS]).toContain('voidRisk');
    expect([...ANALYZE_WEIGHTED_ALL_COLUMNS]).toContain('patternIds');
    expect([...ANALYZE_WEIGHTED_ALL_COLUMNS]).toContain('pVoidPrior');
    expect([...ANALYZE_WEIGHTED_ALL_COLUMNS]).toContain('eyeOpeners');
    expect(ANALYZE_WEIGHTED_FIELD_SCHEMA.map(f => f.key)).toEqual([
      ...ANALYZE_WEIGHTED_ALL_COLUMNS,
    ]);
  });

  test('flatten row includes settlement for live tennis ML', () => {
    const settlement = weightLiveTrackerMove({
      sportId: 'tennis',
      phase: 'live',
      marketType: '3',
      period: 'm',
      decimalOdds: 1.95,
      pWin: 0.55,
    });
    const row = flattenWeightedEventRow({
      time: '2026-08-10T10:00:02.000Z',
      eventType: 'PRICE_CHANGE',
      eventId: 197510101,
      period: 'm',
      marketType: '3',
      selection: '1',
      from: 1.9,
      to: 1.95,
      detail: 'price m/3/1 1.9→1.95',
      file: 'event-197510101.jsonl',
      settlement,
    });
    expect(row.voidRisk).toBe('high');
    expect(row.marketClass).toBe('match_ml');
    expect(row.preferUnitMkts).toBe(true);
    expect(String(row.patternIds)).toContain('void.live-ml-unfinished');
    expect(row.pVoidPrior).toBe(0.15);
    expect(row.voidEv).not.toBeNull();
    expect(row.timeMs).toBe(Date.parse('2026-08-10T10:00:02.000Z'));
    expect(row.time).toBe('2026-08-10T10:00:02.000Z');
    for (const k of ANALYZE_WEIGHTED_ALL_COLUMNS) {
      expect(row).toHaveProperty(k);
    }
  });

  test('artifact + tables render', () => {
    const settlement = weightLiveTrackerMove({
      sportId: 'tennis',
      phase: 'live',
      marketType: '3',
      period: 'm',
      decimalOdds: 1.88,
    });
    const artifact = buildAnalyzeSnapshotArtifact({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      desc: false,
      events: [
        {
          time: '2026-08-10T10:00:05.000Z',
          eventType: 'PRICE_CHANGE',
          eventId: 197510101,
          period: 'm',
          marketType: '3',
          selection: '1',
          from: 1.95,
          to: 1.88,
          detail: 'price',
          settlement,
        },
      ],
    });
    expect(artifact.rows).toHaveLength(1);
    const md = formatAnalyzeMarkdownTable(artifact.rows, ['time', 'voidRisk', 'patternIds']);
    expect(md).toContain('voidRisk');
    expect(md).toContain('high');
    const table = formatAnalyzeInspectTable(artifact.rows, ['time', 'voidRisk', 'maxSeverity']);
    expect(table.length).toBeGreaterThan(10);
  });
});
