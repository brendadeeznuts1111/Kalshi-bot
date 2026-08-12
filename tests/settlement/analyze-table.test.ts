// @see https://bun.com/docs/test/writing-tests#matchers
// @see https://bun.com/docs/test
import { describe, expect, test } from 'bun:test';
import {
  ANALYZE_COLUMN_PRESET_NAMES,
  ANALYZE_COLUMN_PRESETS,
  ANALYZE_WEIGHTED_ALL_COLUMNS,
  ANALYZE_WEIGHTED_FIELD_SCHEMA,
  buildAnalyzeInspectMeta,
  buildAnalyzeSchemaDocument,
  buildAnalyzeSnapshotArtifact,
  flattenWeightedEventRow,
  formatAnalyzeBanner,
  formatAnalyzeHtmlReport,
  formatAnalyzeInspectTable,
  formatAnalyzeMarkdownReport,
  formatAnalyzeMarkdownTable,
  resolveAnalyzeColumns,
  summarizeAnalyzeRows,
  weightLiveTrackerMove,
} from '../../src/settlement/index.ts';

describe('analyze weighted table schema', () => {
  test('schema lists all flat fields with groups', () => {
    expect(ANALYZE_WEIGHTED_FIELD_SCHEMA.length).toBeGreaterThan(20);
    expect([...ANALYZE_WEIGHTED_ALL_COLUMNS]).toEqual(
      expect.arrayContaining(['voidRisk', 'patternIds', 'pVoidPrior', 'eyeOpeners', 'timeMs']),
    );
    expect(ANALYZE_WEIGHTED_FIELD_SCHEMA.map(f => f.key)).toEqual([
      ...ANALYZE_WEIGHTED_ALL_COLUMNS,
    ]);
    const groups = new Set(ANALYZE_WEIGHTED_FIELD_SCHEMA.map(f => f.group));
    expect([...groups]).toEqual(
      expect.arrayContaining(['event', 'odds', 'settlement', 'patterns', 'ev']),
    );
    expect(resolveAnalyzeColumns(['ev'])).toEqual([...ANALYZE_COLUMN_PRESETS.ev]);
    expect(resolveAnalyzeColumns(['all'])).toHaveLength(ANALYZE_WEIGHTED_ALL_COLUMNS.length);
    expect([...ANALYZE_COLUMN_PRESET_NAMES]).toEqual(
      expect.arrayContaining(['desk', 'ev', 'all']),
    );
    const doc = buildAnalyzeSchemaDocument();
    expect(doc.schemaVersion).toBe(3);
    expect(doc.presets?.desk).toBeDefined();
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
      schemaVersion: 3,
    });
    expect(artifact.summary.rowCount).toBe(1);
    expect(artifact.summary.byVoidRisk.high).toBe(1);
    expect(artifact.summary.dualStamp.withTimeMs).toBe(1);
    expect(artifact.markdownDesk).toContain('voidRisk');
    expect(artifact.markdownReport).toContain('## Preset `ev`');
    expect(artifact.presets.ev).toContain('voidEv');
    const md = formatAnalyzeMarkdownTable(artifact.rows, ['time', 'voidRisk', 'patternIds']);
    expect(md).toMatch(/voidRisk/);
    expect(md).toMatch(/high/);
    // Number columns use right-align separator in GFM
    const evMd = formatAnalyzeMarkdownTable(artifact.rows, ['ev']);
    expect(evMd).toMatch(/---:/);
    const banner = formatAnalyzeBanner({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity'],
      summary: artifact.summary,
      schemaVersion: 3,
    });
    expect(banner).toContain('rows=1');
    expect(banner).toContain('voidRisk[high=1]');
    const meta = buildAnalyzeInspectMeta({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity'],
      desc: false,
      columns: resolveAnalyzeColumns(['ev']),
      rows: artifact.rows,
      schemaVersion: 3,
    });
    expect(meta).toMatchObject({
      columnCount: ANALYZE_COLUMN_PRESETS.ev.length,
      summary: expect.objectContaining({ withVoidEv: expect.any(Number) }),
    });
    const html = formatAnalyzeHtmlReport({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity'],
      rows: artifact.rows,
      schemaVersion: 3,
    });
    expect(html).toContain('<table>');
    expect(html).toContain('voidRisk');
    expect(summarizeAnalyzeRows([])).toMatchObject({ rowCount: 0, meanVoidDelta: null });
    expect(formatAnalyzeMarkdownReport({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['id'],
      rows: artifact.rows,
    })).toContain('## Summary');
    const table = formatAnalyzeInspectTable(artifact.rows, ['time', 'voidRisk', 'maxSeverity']);
    expect(table.length).toBeGreaterThan(10);
  });
});
