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
    expect(r.htmlReport).toContain('<table>');
    expect(r.htmlReport).toContain('voidRisk');
    expect(r.artifact.summary.meanVoidDelta).toBe(-15);
  });
});
