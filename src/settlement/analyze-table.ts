/**
 * Flat schema + sample table for live-tracker analyze --sport snapshots.
 * Used for Bun.inspect.table / markdown artifacts so nested settlement/patterns
 * are not collapsed to `[Object …]`.
 *
 * @see docs/artifacts/live-tracker-analyze-schema.json
 * @see docs/artifacts/live-tracker-analyze-sample.json
 */

import type { LiveTrackerWeightResult } from './live-weight.ts';

/** Event + settlement + pattern fields for desk tables. */
export const ANALYZE_WEIGHTED_FIELD_SCHEMA = [
  { key: 'time', type: 'string', description: 'Event ISO time' },
  { key: 'eventType', type: 'string', description: 'MARKET_ADDED | PRICE_CHANGE | …' },
  { key: 'eventId', type: 'string', description: 'Pandora event id' },
  { key: 'period', type: 'string', description: 'm | s1 | h1 | …' },
  { key: 'marketType', type: 'string', description: 'Pandora market id (3=ML, 5=total, …)' },
  { key: 'selection', type: 'string', description: 'Selection key when present' },
  { key: 'from', type: 'string', description: 'Prior decimal odds' },
  { key: 'to', type: 'string', description: 'New decimal odds' },
  { key: 'detail', type: 'string', description: 'Human detail line' },
  { key: 'file', type: 'string', description: 'Source log basename' },
  // settlement
  { key: 'sportKey', type: 'string', description: 'Weighting sport key' },
  { key: 'phase', type: 'string', description: 'prematch | live' },
  { key: 'marketClass', type: 'string', description: 'match_ml | set_market | …' },
  { key: 'actionThreshold', type: 'string', description: 'Shell action rule label' },
  { key: 'voidRisk', type: 'string', description: 'low | medium | high | unknown' },
  { key: 'preferUnitMkts', type: 'boolean', description: 'Prefer completed set/game markets' },
  { key: 'pVoidPrior', type: 'number', description: 'Default void mass for three-way EV' },
  { key: 'maxSeverity', type: 'string', description: 'Max pattern severity on this row' },
  { key: 'patternIds', type: 'string', description: 'Comma-separated pattern ids (non-info first)' },
  { key: 'patternCount', type: 'number', description: 'Number of pattern hits' },
  { key: 'eyeOpeners', type: 'string', description: 'Joined watch+ severity notes' },
  { key: 'sizingNote', type: 'string', description: 'Desk sizing one-liner' },
  { key: 'summary', type: 'string', description: 'Compact weighting summary' },
  { key: 'voidEv', type: 'number|null', description: 'Three-way EV at stake 100 if odds known' },
  { key: 'twoWayEv', type: 'number|null', description: 'Two-way EV (void as lose)' },
  { key: 'voidDelta', type: 'number|null', description: 'twoWayEv - voidEv' },
  { key: 'pliveEqEzlive', type: 'boolean', description: 'Settlement identical across products' },
] as const;

export type AnalyzeWeightedFieldKey = (typeof ANALYZE_WEIGHTED_FIELD_SCHEMA)[number]['key'];

/** Default table column order (subset of schema for TTY width). */
export const ANALYZE_WEIGHTED_DEFAULT_COLUMNS: readonly AnalyzeWeightedFieldKey[] = [
  'time',
  'eventType',
  'period',
  'marketType',
  'from',
  'to',
  'voidRisk',
  'maxSeverity',
  'patternIds',
  'pVoidPrior',
  'sizingNote',
] as const;

/** Full column set for artifacts / --columns all. */
export const ANALYZE_WEIGHTED_ALL_COLUMNS: readonly AnalyzeWeightedFieldKey[] =
  ANALYZE_WEIGHTED_FIELD_SCHEMA.map(f => f.key);

export type WeightedTrackerEvent = {
  time: string;
  eventType: string;
  eventId: number | string;
  period?: string;
  marketType?: string;
  selection?: string;
  detail: string;
  from?: number | string | null;
  to?: number | string | null;
  file?: string;
  settlement?: LiveTrackerWeightResult;
};

export type AnalyzeWeightedRow = Record<AnalyzeWeightedFieldKey, string | number | boolean | null>;

function basen(file?: string): string {
  if (!file) return '—';
  const parts = file.split('/');
  return parts[parts.length - 1] || file;
}

/**
 * Flatten event + settlement + patterns into one table row (all schema fields).
 */
export function flattenWeightedEventRow(e: WeightedTrackerEvent): AnalyzeWeightedRow {
  const s = e.settlement;
  const w = s?.weighting;
  const hits = s?.patterns ?? [];
  const nonInfo = hits.filter(h => h.severity !== 'info');
  const patternIds = (nonInfo.length ? nonInfo : hits)
    .map(h => h.patternId)
    .join(', ');
  const maxSeverity =
    s?.patternScan?.maxSeverity ??
    (hits[0]?.severity ?? '—');

  return {
    time: e.time,
    eventType: e.eventType,
    eventId: String(e.eventId),
    period: e.period ?? '—',
    marketType: e.marketType ?? '—',
    selection: e.selection ?? '—',
    from: e.from != null ? String(e.from) : '—',
    to: e.to != null ? String(e.to) : '—',
    detail: e.detail,
    file: basen(e.file),
    sportKey: w?.sportKey ?? '—',
    phase: w?.phase ?? '—',
    marketClass: w?.marketClass ?? '—',
    actionThreshold: w?.actionThreshold ?? '—',
    voidRisk: w?.voidRisk ?? '—',
    preferUnitMkts: w?.preferCompletedUnitMarkets ?? false,
    pVoidPrior: s?.pVoidPrior ?? 0,
    maxSeverity: String(maxSeverity),
    patternIds: patternIds || '—',
    patternCount: hits.length,
    eyeOpeners: (s?.eyeOpeners ?? []).join(' · ') || '—',
    sizingNote: s?.sizingNote ?? '—',
    summary: s?.summary ?? '—',
    voidEv: s?.voidEv?.ev ?? null,
    twoWayEv: s?.voidEv?.twoWayEv ?? null,
    voidDelta: s?.voidEv?.voidDelta ?? null,
    pliveEqEzlive: w?.settlementIdenticalPliveEzlive ?? true,
  };
}

export function flattenWeightedEvents(events: WeightedTrackerEvent[]): AnalyzeWeightedRow[] {
  return events
    .filter(e => e.settlement != null || e.eventType === 'PRICE_CHANGE' || e.eventType === 'MARKET_ADDED')
    .map(flattenWeightedEventRow);
}

/**
 * Project rows to selected columns for Bun.inspect.table / markdown.
 */
export function projectAnalyzeRows(
  rows: AnalyzeWeightedRow[],
  columns: readonly string[] = ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
): Array<Record<string, string | number | boolean | null>> {
  const cols =
    columns.length === 1 && columns[0] === 'all'
      ? [...ANALYZE_WEIGHTED_ALL_COLUMNS]
      : columns.length
        ? columns
        : [...ANALYZE_WEIGHTED_DEFAULT_COLUMNS];
  return rows.map(row => {
    const o: Record<string, string | number | boolean | null> = {};
    for (const c of cols) {
      const k = c as AnalyzeWeightedFieldKey;
      o[c] = row[k] ?? '—';
    }
    return o;
  });
}

/** Markdown table from projected rows. */
export function formatAnalyzeMarkdownTable(
  rows: AnalyzeWeightedRow[],
  columns: readonly string[] = ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
): string {
  const projected = projectAnalyzeRows(rows, columns);
  if (!projected.length) return '(no weighted rows)';
  const cols = Object.keys(projected[0]!);
  const cell = (v: unknown) => {
    const s = v == null ? '—' : String(v);
    return s.replace(/\|/g, '\\|').slice(0, 120);
  };
  const header = '| ' + cols.join(' | ') + ' |';
  const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const body = projected.map(r => '| ' + cols.map(c => cell(r[c])).join(' | ') + ' |');
  return [header, sep, ...body].join('\n');
}

/**
 * Bun.inspect.table string for weighted analyze rows.
 * @see https://bun.com/docs/runtime/utils#bun-inspect-table
 */
export function formatAnalyzeInspectTable(
  rows: AnalyzeWeightedRow[],
  columns: readonly string[] = ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
  options: { colors?: boolean } = {},
): string {
  const projected = projectAnalyzeRows(rows, columns);
  if (!projected.length) return '(no weighted rows)';
  const cols = Object.keys(projected[0]!);
  // @see https://bun.com/docs/runtime/utils#bun-inspect-table
  return Bun.inspect.table(projected, cols, {
    colors: options.colors ?? false,
  });
}

export type AnalyzeSnapshotArtifact = {
  schemaVersion: 1;
  sportId: string;
  phase: string;
  sortBy: string[];
  desc: boolean;
  fields: typeof ANALYZE_WEIGHTED_FIELD_SCHEMA;
  defaultColumns: readonly string[];
  allColumns: readonly string[];
  rows: AnalyzeWeightedRow[];
  generatedAt: string;
};

export function buildAnalyzeSnapshotArtifact(input: {
  sportId: string;
  phase: string;
  sortBy: string[];
  desc: boolean;
  events: WeightedTrackerEvent[];
}): AnalyzeSnapshotArtifact {
  return {
    schemaVersion: 1,
    sportId: input.sportId,
    phase: input.phase,
    sortBy: input.sortBy,
    desc: input.desc,
    fields: ANALYZE_WEIGHTED_FIELD_SCHEMA,
    defaultColumns: ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
    allColumns: ANALYZE_WEIGHTED_ALL_COLUMNS,
    rows: flattenWeightedEvents(input.events),
    generatedAt: new Date().toISOString(),
  };
}
