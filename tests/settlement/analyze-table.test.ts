// @see https://bun.com/docs/test/writing-tests#matchers
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
    expect([...ANALYZE_WEIGHTED_ALL_COLUMNS]).toEqual(
      expect.arrayContaining(['voidRisk', 'patternIds', 'pVoidPrior', 'eyeOpeners', 'timeMs']),
    );
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
    expect(row).toMatchObject({
      voidRisk: 'high',
      marketClass: 'match_ml',
      preferUnitMkts: true,
      pVoidPrior: 0.15,
      time: '2026-08-10T10:00:02.000Z',
      timeMs: Date.parse('2026-08-10T10:00:02.000Z'),
      eventType: 'PRICE_CHANGE',
      marketType: '3',
    });
    expect(String(row.patternIds)).toMatch(/void\.live-ml-unfinished/);
    expect(row.voidEv).toEqual(expect.any(Number));
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
    expect(artifact).toMatchObject({
      sportId: 'tennis',
      phase: 'live',
      schemaVersion: 1,
    });
    const md = formatAnalyzeMarkdownTable(artifact.rows, ['time', 'voidRisk', 'patternIds']);
    expect(md).toMatch(/voidRisk/);
    expect(md).toMatch(/high/);
    const table = formatAnalyzeInspectTable(artifact.rows, ['time', 'voidRisk', 'maxSeverity']);
    expect(table.length).toBeGreaterThan(10);
  });
});
