/**
 * Recipe integration: desk --table, ev --inspect, all multi-preset report.
 * Fixture SSOT: tests/fixtures/live-tracker-event-197510101.jsonl
 */
// @see https://bun.com/docs/test/writing-tests#matchers
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { loadTrackerEventsFromPaths, weightTrackerEvents } from '../../src/inventory/live-tracker.ts';
import {
  ANALYZE_COLUMN_PRESETS,
  renderSportAnalyze,
} from '../../src/settlement/index.ts';

const FIXTURE = join(import.meta.dir, '../fixtures/live-tracker-event-197510101.jsonl');

async function loadWeighted() {
  const events = await loadTrackerEventsFromPaths([FIXTURE]);
  return weightTrackerEvents(events, {
    sportId: 'tennis',
    phase: 'live',
    patternSort: { sortBy: ['severity', 'id'], desc: false },
  });
}

describe('analyze recipes (fixture jsonl)', () => {
  test('desk table recipe: banner + desk columns + voidRisk mix', async () => {
    const weighted = await loadWeighted();
    const r = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['desk'],
    });
    expect(r.artifact.schemaVersion).toBe(3);
    expect(r.artifact.summary.rowCount).toBe(6);
    expect(r.artifact.summary.byVoidRisk.high).toBe(5);
    expect(r.artifact.summary.byVoidRisk.medium).toBe(1);
    expect(r.artifact.summary.dualStamp.withTimeMs).toBe(6);
    expect(r.banner).toContain('rows=6');
    expect(r.banner).toContain('voidRisk[high=5 medium=1]');
    expect(r.banner).toContain('schema v3');
    expect(r.focusPreset).toBe('desk');
    expect(r.columns).toEqual([...ANALYZE_COLUMN_PRESETS.desk]);
    expect(r.tableInspect).toContain('voidRisk');
    expect(r.tableInspect).toContain('sizingNote');
    expect(r.tableInspect).not.toContain('voidEv'); // desk omits EV cols
    // --html --columns=desk → focused page (not all presets)
    expect(r.htmlView).toContain('Preset <code>desk</code>');
    expect(r.htmlView).toContain('tennis / live · desk');
    expect(r.htmlView).not.toContain('Preset <code>ev</code>');
    expect(r.htmlView).not.toContain('Preset <code>all</code>');
    // bake body stays full multi-preset
    expect(r.htmlReport).toContain('Preset <code>ev</code>');
  });

  test('ev inspect recipe: meta summary + EV columns', async () => {
    const weighted = await loadWeighted();
    const r = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['ev'],
    });
    expect(r.columns).toEqual([...ANALYZE_COLUMN_PRESETS.ev]);
    expect(r.inspectMeta).toMatchObject({
      schemaVersion: 3,
      rowCount: 6,
      columnCount: ANALYZE_COLUMN_PRESETS.ev.length,
      rowSort: { sortBy: ['voidDelta', 'voidEv', 'time'], desc: false },
    });
    const summary = r.inspectMeta.summary as {
      meanVoidDelta: number | null;
      withVoidEv: number;
    };
    expect(summary.withVoidEv).toBe(4);
    expect(summary.meanVoidDelta).toBe(-15);
    expect(r.tableInspect).toContain('voidEv');
    expect(r.tableInspect).toContain('voidDelta');
    expect(r.tableInspect).toContain('12.5');
    // Default EV row sort: finite voidDelta first, nulls last
    const deltas = r.artifact.rows.map(row => row.voidDelta);
    expect(deltas.slice(0, 4).every(d => typeof d === 'number')).toBe(true);
    expect(deltas.slice(4).every(d => d == null)).toBe(true);
    expect(r.banner).toContain('sort=voidDelta,voidEv,time');
    expect(r.htmlView).toContain('Pipeline: sort=voidDelta,voidEv,time');
    expect(r.htmlView).toContain('summary-chips');
    expect(r.htmlView).toContain('void high');
  });

  test('all bake recipe: multi-preset md + html', async () => {
    const weighted = await loadWeighted();
    const r = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['all'],
    });
    expect(r.columns).toHaveLength(28);
    expect(r.markdownReport).toContain('## Summary');
    expect(r.markdownReport).toContain('## Preset `desk`');
    expect(r.markdownReport).toContain('## Preset `ev`');
    expect(r.markdownReport).toContain('## Preset `all`');
    expect(r.htmlReport).toContain('<!DOCTYPE html>');
    expect(r.htmlReport).toContain('table-wrap');
    expect(r.htmlReport).toContain('voidRisk');
    expect(r.htmlReport).toContain('class="risk-high"');
    expect(r.htmlReport).toContain('row-risk-high');
    expect(r.htmlReport).toContain('preset-nav');
    expect(r.htmlReport).toContain('position: sticky');
    expect(r.htmlReport).toContain('Pipeline:');
    expect(r.htmlReport).toContain('summary-chips');
    expect(r.artifact.summary.meanVoidDelta).toBe(-15);
    // Default desk-like risk sort: high before medium
    expect(r.artifact.rows[0]!.voidRisk).toBe('high');
    expect(r.artifact.rows.at(-1)!.voidRisk).toBe('medium');
  });

  test('multi-select desk,ev HTML has only those presets', async () => {
    const weighted = await loadWeighted();
    const r = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['desk', 'ev'],
    });
    // Field union for table paths
    expect(r.columns).toEqual(
      expect.arrayContaining([...ANALYZE_COLUMN_PRESETS.desk, ...ANALYZE_COLUMN_PRESETS.ev]),
    );
    expect(r.htmlView).toContain('Preset <code>desk</code>');
    expect(r.htmlView).toContain('Preset <code>ev</code>');
    expect(r.htmlView).not.toContain('Preset <code>settlement</code>');
    expect(r.htmlView).not.toContain('Preset <code>all</code>');
    expect(r.htmlView).toContain('Recipe:');
    expect(r.htmlView).toContain('--columns=desk,ev');
    expect(r.htmlView).toContain('class="table-wrap"');
    expect(r.htmlView).toContain('preset-nav');
    expect(r.htmlView).toContain('href="#preset-desk"');
    expect(r.htmlView).toContain('href="#preset-ev"');
  });

  test('explicit --sort-rows=time overrides preset default', async () => {
    const weighted = await loadWeighted();
    const r = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['desk'],
      rowSortBy: ['time'],
      rowSortDesc: false,
    });
    const times = r.artifact.rows.map(row => row.timeMs as number);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(r.banner).toContain('sort=time');
  });

  test('void-risk filter + limit triage recipe', async () => {
    const weighted = await loadWeighted();
    const r = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['desk'],
      rowFilter: { voidRisk: ['high'] },
      rowLimit: 3,
    });
    expect(r.artifact.rows).toHaveLength(3);
    expect(r.artifact.rows.every(row => row.voidRisk === 'high')).toBe(true);
    expect(r.artifact.summary.rowCount).toBe(3);
    expect(r.artifact.summary.byVoidRisk.high).toBe(3);
    expect(r.banner).toContain('voidRisk=high');
    expect(r.banner).toContain('limit=3');
    expect(r.banner).toContain('rows=3');
    expect(r.inspectMeta).toMatchObject({
      sourceRowCount: 6,
      rowLimit: 3,
      rowFilter: { voidRisk: ['high'] },
    });
    expect(r.htmlView).toContain('--void-risk=high');
    expect(r.htmlView).toContain('--limit=3');
  });

  test('pattern-family + has-eye + auto-refresh html', async () => {
    const weighted = await loadWeighted();
    const r = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['patterns'],
      rowFilter: { patternFamily: ['void'], hasEye: true },
      autoRefreshSec: 5,
    });
    expect(r.artifact.rows.length).toBeGreaterThan(0);
    expect(
      r.artifact.rows.every(row => String(row.patternIds).includes('void.')),
    ).toBe(true);
    expect(r.banner).toContain('family=void');
    expect(r.banner).toContain('hasEye');
    expect(r.htmlView).toContain('http-equiv="refresh"');
    expect(r.htmlView).toContain('content="5"');
    expect(r.htmlView).toContain('--pattern-family=void');
    expect(r.htmlView).toContain('--has-eye');
    expect(r.htmlView).toContain('--watch');
    expect(r.inspectMeta.autoRefreshSec).toBe(5);
    expect(r.delta).toBeNull();
  });

  test('market-type + periods filter and watch delta on second render', async () => {
    const weighted = await loadWeighted();
    const first = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['desk'],
      rowFilter: { marketType: ['3'], period: ['m'] },
    });
    expect(first.artifact.rows.length).toBeGreaterThan(0);
    expect(first.artifact.rows.every(r => r.marketType === '3' && r.period === 'm')).toBe(
      true,
    );
    expect(first.banner).toContain('mkt=3');
    expect(first.banner).toContain('period=m');
    expect(first.htmlView).toContain('--market-type=3');
    expect(first.htmlView).toContain('--periods=m');

    // Second pass with prevRows: same set → Δ0
    const second = renderSportAnalyze({
      sportId: 'tennis',
      phase: 'live',
      sortBy: ['severity', 'id'],
      events: weighted,
      columns: ['desk'],
      rowFilter: { marketType: ['3'], period: ['m'] },
      prevRows: first.artifact.rows,
      prevSummary: first.artifact.summary,
    });
    expect(second.delta).not.toBeNull();
    expect(second.delta!.added).toBe(0);
    expect(second.delta!.removed).toBe(0);
    expect(second.delta!.hint).toBe('Δ0');
    expect(second.banner).toContain('Δ0');
    expect(second.htmlView).toContain('Watch delta');
  });
});
