/**
 * Flat schema + sample table for live-tracker analyze --sport snapshots.
 * Used for Bun.inspect.table / markdown artifacts so nested settlement/patterns
 * are not collapsed to `[Object …]`.
 *
 * Column presets: desk | odds | settlement | patterns | ev | all
 *
 * @see docs/artifacts/live-tracker-analyze-schema.json
 * @see docs/artifacts/live-tracker-analyze-sample.json
 * @see src/lib/table-schema.ts
 */

import { dualTime } from '../lib/time-ssot.ts';
import {
  buildTableSchemaDocument,
  formatInspectTableFromRows,
  formatMarkdownTable,
  projectTableRows,
  resolveTableColumns,
  type TableFieldSpec,
} from '../lib/table-schema.ts';
import type { LiveTrackerWeightResult } from './live-weight.ts';

/** Event + settlement + pattern fields for desk tables. */
export const ANALYZE_WEIGHTED_FIELD_SCHEMA = [
  // event
  {
    key: 'time',
    type: 'string',
    description: 'Event ISO-8601 UTC (wall clock)',
    group: 'event',
  },
  {
    key: 'timeMs',
    type: 'number|null',
    description: 'Same instant as Unix epoch milliseconds (join key for shadow/event-store)',
    group: 'event',
    align: 'right',
  },
  {
    key: 'eventType',
    type: 'string',
    description: 'MARKET_ADDED | PRICE_CHANGE | …',
    group: 'event',
  },
  {
    key: 'eventId',
    type: 'string',
    description: 'Pandora event id',
    group: 'event',
  },
  {
    key: 'period',
    type: 'string',
    description: 'm | s1 | h1 | …',
    group: 'event',
  },
  {
    key: 'marketType',
    type: 'string',
    description: 'Pandora market id (3=ML, 5=total, …)',
    group: 'event',
  },
  {
    key: 'selection',
    type: 'string',
    description: 'Selection key when present',
    group: 'event',
  },
  {
    key: 'detail',
    type: 'string',
    description: 'Human detail line',
    group: 'event',
    maxWidth: 80,
  },
  {
    key: 'file',
    type: 'string',
    description: 'Source log basename',
    group: 'event',
  },
  // odds
  {
    key: 'from',
    type: 'string',
    description: 'Prior decimal odds',
    group: 'odds',
    align: 'right',
  },
  {
    key: 'to',
    type: 'string',
    description: 'New decimal odds',
    group: 'odds',
    align: 'right',
  },
  // settlement
  {
    key: 'sportKey',
    type: 'string',
    description: 'Weighting sport key',
    group: 'settlement',
  },
  {
    key: 'phase',
    type: 'string',
    description: 'prematch | live',
    group: 'settlement',
  },
  {
    key: 'marketClass',
    type: 'string',
    description: 'match_ml | set_market | …',
    group: 'settlement',
  },
  {
    key: 'actionThreshold',
    type: 'string',
    description: 'Shell action rule label',
    group: 'settlement',
  },
  {
    key: 'voidRisk',
    type: 'string',
    description: 'low | medium | high | unknown',
    group: 'settlement',
  },
  {
    key: 'preferUnitMkts',
    type: 'boolean',
    description: 'Prefer completed set/game markets',
    group: 'settlement',
  },
  {
    key: 'pVoidPrior',
    type: 'number',
    description: 'Default void mass for three-way EV',
    group: 'settlement',
    align: 'right',
  },
  {
    key: 'pliveEqEzlive',
    type: 'boolean',
    description: 'Settlement identical across products',
    group: 'settlement',
  },
  {
    key: 'sizingNote',
    type: 'string',
    description: 'Desk sizing one-liner',
    group: 'settlement',
    maxWidth: 72,
  },
  {
    key: 'summary',
    type: 'string',
    description: 'Compact weighting summary',
    group: 'settlement',
    maxWidth: 72,
  },
  // patterns
  {
    key: 'maxSeverity',
    type: 'string',
    description: 'Max pattern severity on this row',
    group: 'patterns',
  },
  {
    key: 'patternIds',
    type: 'string',
    description: 'Comma-separated pattern ids (non-info first)',
    group: 'patterns',
    maxWidth: 64,
  },
  {
    key: 'patternCount',
    type: 'number',
    description: 'Number of pattern hits',
    group: 'patterns',
    align: 'right',
  },
  {
    key: 'eyeOpeners',
    type: 'string',
    description: 'Joined watch+ severity notes',
    group: 'patterns',
    maxWidth: 72,
  },
  // ev
  {
    key: 'voidEv',
    type: 'number|null',
    description: 'Three-way EV at stake 100 if odds known',
    group: 'ev',
    align: 'right',
  },
  {
    key: 'twoWayEv',
    type: 'number|null',
    description: 'Two-way EV (void as lose)',
    group: 'ev',
    align: 'right',
  },
  {
    key: 'voidDelta',
    type: 'number|null',
    description: 'twoWayEv - voidEv',
    group: 'ev',
    align: 'right',
  },
] as const satisfies readonly TableFieldSpec[];

export type AnalyzeWeightedFieldKey = (typeof ANALYZE_WEIGHTED_FIELD_SCHEMA)[number]['key'];

/** Named column presets for TTY / --columns. */
export const ANALYZE_COLUMN_PRESETS = {
  desk: [
    'time',
    'timeMs',
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
  ],
  odds: ['time', 'eventType', 'period', 'marketType', 'selection', 'from', 'to', 'detail'],
  settlement: [
    'time',
    'eventType',
    'sportKey',
    'phase',
    'marketClass',
    'actionThreshold',
    'voidRisk',
    'preferUnitMkts',
    'pVoidPrior',
    'pliveEqEzlive',
    'sizingNote',
    'summary',
  ],
  patterns: [
    'time',
    'eventType',
    'voidRisk',
    'maxSeverity',
    'patternIds',
    'patternCount',
    'eyeOpeners',
  ],
  ev: [
    'time',
    'eventType',
    'from',
    'to',
    'voidRisk',
    'pVoidPrior',
    'voidEv',
    'twoWayEv',
    'voidDelta',
  ],
} as const satisfies Record<string, readonly AnalyzeWeightedFieldKey[]>;

/** Default table column order (desk preset). */
export const ANALYZE_WEIGHTED_DEFAULT_COLUMNS: readonly AnalyzeWeightedFieldKey[] =
  ANALYZE_COLUMN_PRESETS.desk;

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

  const dual = dualTime(e.time);
  return {
    time: dual?.time ?? e.time,
    timeMs: dual?.timeMs ?? null,
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

/** Resolve desk/odds/settlement/patterns/ev/all or explicit keys. */
export function resolveAnalyzeColumns(
  requested?: readonly string[],
): AnalyzeWeightedFieldKey[] {
  return resolveTableColumns(
    requested,
    ANALYZE_COLUMN_PRESETS,
    ANALYZE_WEIGHTED_ALL_COLUMNS,
    ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
  );
}

/**
 * Project rows to selected columns for Bun.inspect.table / markdown.
 */
export function projectAnalyzeRows(
  rows: AnalyzeWeightedRow[],
  columns: readonly string[] = ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
): Array<Record<string, string | number | boolean | null>> {
  const cols = resolveAnalyzeColumns(columns);
  return projectTableRows(rows, cols);
}

/** Markdown table from projected rows (aligned number columns). */
export function formatAnalyzeMarkdownTable(
  rows: AnalyzeWeightedRow[],
  columns: readonly string[] = ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
): string {
  const cols = resolveAnalyzeColumns(columns);
  const projected = projectTableRows(rows, cols);
  if (!projected.length) return '(no weighted rows)';
  return formatMarkdownTable(projected, cols, {
    fields: ANALYZE_WEIGHTED_FIELD_SCHEMA as unknown as readonly TableFieldSpec[],
  });
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
  const cols = resolveAnalyzeColumns(columns);
  const projected = projectTableRows(rows, cols);
  if (!projected.length) return '(no weighted rows)';
  return formatInspectTableFromRows(projected, cols, options).trimEnd();
}

export type AnalyzeSnapshotArtifact = {
  schemaVersion: 2;
  description: string;
  sportId: string;
  phase: string;
  sortBy: string[];
  desc: boolean;
  fields: typeof ANALYZE_WEIGHTED_FIELD_SCHEMA;
  groups: Record<string, readonly string[]>;
  presets: typeof ANALYZE_COLUMN_PRESETS;
  defaultColumns: readonly string[];
  allColumns: readonly string[];
  rows: AnalyzeWeightedRow[];
  /** Desk-preset markdown for human skim. */
  markdownDesk: string;
  generatedAt: string;
};

export function buildAnalyzeSchemaDocument() {
  return buildTableSchemaDocument({
    schemaVersion: 2,
    description:
      'Flat row schema for live-tracker analyze --sport (settlement + edge patterns). Column presets: desk | odds | settlement | patterns | ev | all.',
    fields: ANALYZE_WEIGHTED_FIELD_SCHEMA as unknown as readonly TableFieldSpec<AnalyzeWeightedFieldKey>[],
    presets: ANALYZE_COLUMN_PRESETS,
    defaultColumns: ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
  });
}

export function buildAnalyzeSnapshotArtifact(input: {
  sportId: string;
  phase: string;
  sortBy: string[];
  desc: boolean;
  events: WeightedTrackerEvent[];
}): AnalyzeSnapshotArtifact {
  const schema = buildAnalyzeSchemaDocument();
  const rows = flattenWeightedEvents(input.events);
  return {
    schemaVersion: 2,
    description: schema.description,
    sportId: input.sportId,
    phase: input.phase,
    sortBy: input.sortBy,
    desc: input.desc,
    fields: ANALYZE_WEIGHTED_FIELD_SCHEMA,
    groups: schema.groups as Record<string, readonly string[]>,
    presets: ANALYZE_COLUMN_PRESETS,
    defaultColumns: ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
    allColumns: ANALYZE_WEIGHTED_ALL_COLUMNS,
    rows,
    markdownDesk: formatAnalyzeMarkdownTable(rows, ANALYZE_WEIGHTED_DEFAULT_COLUMNS),
    generatedAt: new Date().toISOString(),
  };
}
