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

import { markdownToHtml } from '../lib/markdown.ts';
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

/** Stable preset names for CLI help / inspect meta. */
export const ANALYZE_COLUMN_PRESET_NAMES = [
  'desk',
  'odds',
  'settlement',
  'patterns',
  'ev',
  'all',
] as const;

export type AnalyzeColumnPresetName = (typeof ANALYZE_COLUMN_PRESET_NAMES)[number];

/** Row sort keys for desk tables / HTML (orthogonal to pattern hit --sort-by). */
export type AnalyzeRowSortKey =
  | 'time'
  | 'voidRisk'
  | 'voidDelta'
  | 'voidEv'
  | 'maxSeverity'
  | 'eventType'
  | 'marketClass';

const VOID_RISK_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
  unknown: 3,
  '—': 4,
};

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  watch: 2,
  info: 3,
  '—': 4,
};

function rankOrTail(map: Record<string, number>, key: string): number {
  return map[key] ?? 50;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Sort flat analyze rows for display (table / HTML / CSV).
 * Default multi-key: voidRisk → maxSeverity → time.
 */
export function sortAnalyzeRows(
  rows: readonly AnalyzeWeightedRow[],
  options: {
    sortBy?: AnalyzeRowSortKey | AnalyzeRowSortKey[];
    desc?: boolean;
  } = {},
): AnalyzeWeightedRow[] {
  const keys: AnalyzeRowSortKey[] = options.sortBy
    ? Array.isArray(options.sortBy)
      ? options.sortBy
      : [options.sortBy]
    : ['voidRisk', 'maxSeverity', 'time'];
  const desc = options.desc === true;
  const out = [...rows];
  out.sort((a, b) => {
    for (const key of keys) {
      let cmp = 0;
      if (key === 'voidRisk') {
        cmp =
          rankOrTail(VOID_RISK_RANK, String(a.voidRisk)) -
          rankOrTail(VOID_RISK_RANK, String(b.voidRisk));
      } else if (key === 'maxSeverity') {
        cmp =
          rankOrTail(SEVERITY_RANK, String(a.maxSeverity)) -
          rankOrTail(SEVERITY_RANK, String(b.maxSeverity));
      } else if (key === 'voidDelta' || key === 'voidEv' || key === 'time') {
        const av =
          key === 'time'
            ? numOrNull(a.timeMs) ?? Number.POSITIVE_INFINITY
            : numOrNull(a[key]) ?? (desc ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
        const bv =
          key === 'time'
            ? numOrNull(b.timeMs) ?? Number.POSITIVE_INFINITY
            : numOrNull(b[key]) ?? (desc ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
        cmp = av === bv ? 0 : av < bv ? -1 : 1;
      } else {
        cmp = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
      }
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
  return out;
}

/** Parse `--sort-rows=voidRisk,voidDelta` (comma-separated). */
export function parseAnalyzeRowSortBy(
  raw: string | undefined | null,
  fallback: AnalyzeRowSortKey[] = ['voidRisk', 'maxSeverity', 'time'],
): AnalyzeRowSortKey[] {
  if (!raw?.trim()) return fallback;
  const allowed = new Set<AnalyzeRowSortKey>([
    'time',
    'voidRisk',
    'voidDelta',
    'voidEv',
    'maxSeverity',
    'eventType',
    'marketClass',
  ]);
  const keys = raw
    .split(',')
    .map(s => s.trim())
    .filter((k): k is AnalyzeRowSortKey => allowed.has(k as AnalyzeRowSortKey));
  return keys.length ? keys : fallback;
}

/**
 * Default row sort for a focus preset (EV → worst voidΔ first).
 */
export function defaultRowSortForPreset(
  focus: AnalyzeColumnPresetName | null,
): { sortBy: AnalyzeRowSortKey[]; desc: boolean } {
  if (focus === 'ev') return { sortBy: ['voidDelta', 'voidEv', 'time'], desc: false };
  if (focus === 'patterns') return { sortBy: ['maxSeverity', 'voidRisk', 'time'], desc: false };
  return { sortBy: ['voidRisk', 'maxSeverity', 'time'], desc: false };
}

/** Allowlist filters for display rows (CLI triage). Empty / omitted = no filter. */
export type AnalyzeRowFilter = {
  voidRisk?: readonly string[];
  maxSeverity?: readonly string[];
  marketClass?: readonly string[];
  eventType?: readonly string[];
  /** Pandora market type ids (`3`, `4`, …). */
  marketType?: readonly string[];
  /** Period tokens (`m`, `s1`, …) — orthogonal to weighting `--period`. */
  period?: readonly string[];
  /** Event id allowlist. */
  eventId?: readonly string[];
  /**
   * Substring match against `patternIds` (any needle hits).
   * e.g. `void.live-ml-unfinished` or bare `void`.
   */
  pattern?: readonly string[];
  /**
   * Pattern family / id-prefix match against comma-separated `patternIds`.
   * Hits when id equals family, starts with `family.`, or contains family token.
   */
  patternFamily?: readonly string[];
  /** When true, only rows with non-empty eyeOpeners. */
  hasEye?: boolean;
  /** Inclusive lower bound on `timeMs` (epoch ms). */
  sinceMs?: number;
  /** Inclusive upper bound on `timeMs` (epoch ms). */
  untilMs?: number;
};

/** Parse comma list (`high,medium`) → trimmed tokens; empty → undefined. */
export function parseAnalyzeCsvList(raw: string | undefined | null): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const parts = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

/**
 * Parse `--since` / `--until`: ISO-8601 or epoch (ms if ≥1e12, else seconds).
 */
export function parseAnalyzeTimeBound(raw: string | undefined | null): number | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return undefined;
    return Math.abs(n) < 1e12 ? Math.round(n * 1000) : Math.round(n);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

function allowlistHit(value: unknown, allow: readonly string[] | undefined): boolean {
  if (!allow?.length) return true;
  const v = String(value ?? '').toLowerCase();
  return allow.some(a => a.toLowerCase() === v);
}

function fieldContainsAny(value: unknown, needles: readonly string[] | undefined): boolean {
  if (!needles?.length) return true;
  const hay = String(value ?? '').toLowerCase();
  if (!hay || hay === '—') return false;
  return needles.some(n => hay.includes(n.toLowerCase()));
}

/** True if any pattern id matches a family token (prefix / equality / contains). */
export function patternFamilyMatches(
  patternIds: unknown,
  families: readonly string[] | undefined,
): boolean {
  if (!families?.length) return true;
  const ids = String(patternIds ?? '')
    .split(/[,]+/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!ids.length || (ids.length === 1 && ids[0] === '—')) return false;
  return families.some(f => {
    const fl = f.toLowerCase();
    return ids.some(id => {
      const il = id.toLowerCase();
      return il === fl || il.startsWith(`${fl}.`) || il.includes(fl);
    });
  });
}

function hasEyeOpeners(value: unknown): boolean {
  const s = String(value ?? '').trim();
  return s.length > 0 && s !== '—';
}

function inTimeWindow(
  timeMs: unknown,
  sinceMs: number | undefined,
  untilMs: number | undefined,
): boolean {
  if (sinceMs == null && untilMs == null) return true;
  const t = numOrNull(timeMs);
  if (t == null) return false;
  if (sinceMs != null && t < sinceMs) return false;
  if (untilMs != null && t > untilMs) return false;
  return true;
}

function filterIsEmpty(filter: AnalyzeRowFilter): boolean {
  return (
    !filter.voidRisk?.length &&
    !filter.maxSeverity?.length &&
    !filter.marketClass?.length &&
    !filter.eventType?.length &&
    !filter.marketType?.length &&
    !filter.period?.length &&
    !filter.eventId?.length &&
    !filter.pattern?.length &&
    !filter.patternFamily?.length &&
    !filter.hasEye &&
    filter.sinceMs == null &&
    filter.untilMs == null
  );
}

/** Filter flat analyze rows by allowlisted field values (case-insensitive). */
export function filterAnalyzeRows(
  rows: readonly AnalyzeWeightedRow[],
  filter: AnalyzeRowFilter = {},
): AnalyzeWeightedRow[] {
  if (filterIsEmpty(filter)) return [...rows];
  const {
    voidRisk,
    maxSeverity,
    marketClass,
    eventType,
    marketType,
    period,
    eventId,
    pattern,
    patternFamily,
    hasEye,
    sinceMs,
    untilMs,
  } = filter;
  return rows.filter(
    r =>
      allowlistHit(r.voidRisk, voidRisk) &&
      allowlistHit(r.maxSeverity, maxSeverity) &&
      allowlistHit(r.marketClass, marketClass) &&
      allowlistHit(r.eventType, eventType) &&
      allowlistHit(r.marketType, marketType) &&
      allowlistHit(r.period, period) &&
      allowlistHit(r.eventId, eventId) &&
      fieldContainsAny(r.patternIds, pattern) &&
      patternFamilyMatches(r.patternIds, patternFamily) &&
      (hasEye ? hasEyeOpeners(r.eyeOpeners) : true) &&
      inTimeWindow(r.timeMs, sinceMs, untilMs),
  );
}

/**
 * Display pipeline: filter → sort → limit.
 * Returns rows ready for table/HTML/CSV and a short pipeline hint for banners.
 */
export function pipelineAnalyzeRows(
  rows: readonly AnalyzeWeightedRow[],
  options: {
    filter?: AnalyzeRowFilter;
    sortBy?: AnalyzeRowSortKey | AnalyzeRowSortKey[];
    desc?: boolean;
    /** Keep first N after sort (top-N desk). */
    limit?: number;
  } = {},
): { rows: AnalyzeWeightedRow[]; hint: string } {
  let out = filterAnalyzeRows(rows, options.filter ?? {});
  out = sortAnalyzeRows(out, { sortBy: options.sortBy, desc: options.desc });
  const lim =
    typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit >= 0
      ? Math.floor(options.limit)
      : undefined;
  if (lim != null) out = out.slice(0, lim);

  const bits: string[] = [];
  const f = options.filter ?? {};
  if (f.voidRisk?.length) bits.push(`voidRisk=${f.voidRisk.join('|')}`);
  if (f.maxSeverity?.length) bits.push(`sev=${f.maxSeverity.join('|')}`);
  if (f.marketClass?.length) bits.push(`class=${f.marketClass.join('|')}`);
  if (f.eventType?.length) bits.push(`type=${f.eventType.join('|')}`);
  if (f.marketType?.length) bits.push(`mkt=${f.marketType.join('|')}`);
  if (f.period?.length) bits.push(`period=${f.period.join('|')}`);
  if (f.eventId?.length) bits.push(`event=${f.eventId.join('|')}`);
  if (f.pattern?.length) bits.push(`pattern=${f.pattern.join('|')}`);
  if (f.patternFamily?.length) bits.push(`family=${f.patternFamily.join('|')}`);
  if (f.hasEye) bits.push('hasEye');
  if (f.sinceMs != null) bits.push(`since=${f.sinceMs}`);
  if (f.untilMs != null) bits.push(`until=${f.untilMs}`);
  const sortKeys = options.sortBy
    ? Array.isArray(options.sortBy)
      ? options.sortBy
      : [options.sortBy]
    : ['voidRisk', 'maxSeverity', 'time'];
  bits.push(`sort=${sortKeys.join(',')}${options.desc ? ' desc' : ''}`);
  if (lim != null) bits.push(`limit=${lim}`);
  return { rows: out, hint: bits.join(' · ') };
}

/**
 * Stable identity for watch-tick deltas (event + market line + stamp + price jump).
 */
export function analyzeRowIdentity(r: AnalyzeWeightedRow): string {
  return [
    r.eventId,
    r.period,
    r.marketType,
    r.selection,
    r.eventType,
    r.timeMs ?? r.time,
    r.from,
    r.to,
  ].join('|');
}

/** Watch-tick delta between previous and current display rows. */
export type AnalyzeDisplayDelta = {
  added: number;
  removed: number;
  stable: number;
  /** Stable rows whose voidRisk rank worsened (high < medium < low). */
  riskWorse: number;
  riskBetter: number;
  severityWorse: number;
  severityBetter: number;
  rowCountDelta: number;
  meanVoidDeltaDelta: number | null;
  /** Compact banner / chip hint. */
  hint: string;
};

/**
 * Compare two display snapshots (typically consecutive `--watch` ticks).
 * Returns null when `prev` is absent (first tick).
 */
export function diffAnalyzeDisplay(
  prev: readonly AnalyzeWeightedRow[] | null | undefined,
  next: readonly AnalyzeWeightedRow[],
  options: {
    prevSummary?: AnalyzeRowSummary | null;
    nextSummary?: AnalyzeRowSummary | null;
  } = {},
): AnalyzeDisplayDelta | null {
  if (!prev) return null;
  const prevMap = new Map(prev.map(r => [analyzeRowIdentity(r), r]));
  const nextMap = new Map(next.map(r => [analyzeRowIdentity(r), r]));
  let added = 0;
  let removed = 0;
  let stable = 0;
  let riskWorse = 0;
  let riskBetter = 0;
  let severityWorse = 0;
  let severityBetter = 0;
  for (const [k, nr] of nextMap) {
    const pr = prevMap.get(k);
    if (!pr) {
      added++;
      continue;
    }
    stable++;
    const prRisk = rankOrTail(VOID_RISK_RANK, String(pr.voidRisk));
    const nrRisk = rankOrTail(VOID_RISK_RANK, String(nr.voidRisk));
    if (nrRisk < prRisk) riskWorse++;
    else if (nrRisk > prRisk) riskBetter++;
    const prSev = rankOrTail(SEVERITY_RANK, String(pr.maxSeverity));
    const nrSev = rankOrTail(SEVERITY_RANK, String(nr.maxSeverity));
    if (nrSev < prSev) severityWorse++;
    else if (nrSev > prSev) severityBetter++;
  }
  for (const k of prevMap.keys()) {
    if (!nextMap.has(k)) removed++;
  }
  const prevSum = options.prevSummary ?? summarizeAnalyzeRows(prev);
  const nextSum = options.nextSummary ?? summarizeAnalyzeRows(next);
  const rowCountDelta = nextSum.rowCount - prevSum.rowCount;
  const meanVoidDeltaDelta =
    prevSum.meanVoidDelta != null && nextSum.meanVoidDelta != null
      ? nextSum.meanVoidDelta - prevSum.meanVoidDelta
      : null;
  const bits: string[] = [];
  if (added) bits.push(`+${added}`);
  if (removed) bits.push(`-${removed}`);
  if (riskWorse) bits.push(`risk↑${riskWorse}`);
  if (riskBetter) bits.push(`risk↓${riskBetter}`);
  if (severityWorse) bits.push(`sev↑${severityWorse}`);
  if (severityBetter) bits.push(`sev↓${severityBetter}`);
  if (rowCountDelta) bits.push(`rows${rowCountDelta > 0 ? '+' : ''}${rowCountDelta}`);
  if (meanVoidDeltaDelta != null && Math.abs(meanVoidDeltaDelta) >= 0.05) {
    bits.push(`voidΔ${meanVoidDeltaDelta > 0 ? '+' : ''}${meanVoidDeltaDelta.toFixed(1)}`);
  }
  if (!bits.length) bits.push('Δ0');
  return {
    added,
    removed,
    stable,
    riskWorse,
    riskBetter,
    severityWorse,
    severityBetter,
    rowCountDelta,
    meanVoidDeltaDelta,
    hint: bits.join(' '),
  };
}

/** HTML chip strip for watch-tick delta. */
export function buildAnalyzeDeltaChipsHtml(delta: AnalyzeDisplayDelta): string {
  const chips: string[] = [
    `<span class="chip chip-meta">Δ <span class="n">${delta.hint}</span></span>`,
  ];
  if (delta.added) {
    chips.push(
      `<span class="chip chip-risk-medium">added <span class="n">${delta.added}</span></span>`,
    );
  }
  if (delta.removed) {
    chips.push(
      `<span class="chip chip-meta">removed <span class="n">${delta.removed}</span></span>`,
    );
  }
  if (delta.riskWorse) {
    chips.push(
      `<span class="chip chip-risk-high">risk worse <span class="n">${delta.riskWorse}</span></span>`,
    );
  }
  if (delta.severityWorse) {
    chips.push(
      `<span class="chip chip-sev-high">sev worse <span class="n">${delta.severityWorse}</span></span>`,
    );
  }
  return `<div class="summary-chips" aria-label="Watch delta">${chips.join('')}</div>\n`;
}

/** GFM/CSV-safe cell. */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** CSV export of projected columns (header + rows). */
export function formatAnalyzeCsv(
  rows: AnalyzeWeightedRow[],
  columns: readonly string[] = ANALYZE_WEIGHTED_DEFAULT_COLUMNS,
): string {
  const cols = resolveAnalyzeColumns(columns);
  const projected = projectTableRows(rows, cols, { empty: '' });
  if (!projected.length) return cols.join(',') + '\n';
  const lines = [cols.join(',')];
  for (const r of projected) {
    lines.push(cols.map(c => csvCell(r[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

function bumpCount(map: Record<string, number>, key: string): void {
  const k = key || '—';
  map[k] = (map[k] ?? 0) + 1;
}

/** Aggregate counters for desk banners / inspect meta / bake front-matter. */
export type AnalyzeRowSummary = {
  rowCount: number;
  byVoidRisk: Record<string, number>;
  byMaxSeverity: Record<string, number>;
  byMarketClass: Record<string, number>;
  byEventType: Record<string, number>;
  withVoidEv: number;
  meanVoidDelta: number | null;
  dualStamp: { withTimeMs: number; missingTimeMs: number };
};

export function summarizeAnalyzeRows(rows: readonly AnalyzeWeightedRow[]): AnalyzeRowSummary {
  const byVoidRisk: Record<string, number> = {};
  const byMaxSeverity: Record<string, number> = {};
  const byMarketClass: Record<string, number> = {};
  const byEventType: Record<string, number> = {};
  let withVoidEv = 0;
  let voidDeltaSum = 0;
  let voidDeltaN = 0;
  let withTimeMs = 0;
  let missingTimeMs = 0;
  for (const r of rows) {
    bumpCount(byVoidRisk, String(r.voidRisk));
    bumpCount(byMaxSeverity, String(r.maxSeverity));
    bumpCount(byMarketClass, String(r.marketClass));
    bumpCount(byEventType, String(r.eventType));
    if (typeof r.voidEv === 'number' && Number.isFinite(r.voidEv)) withVoidEv++;
    if (typeof r.voidDelta === 'number' && Number.isFinite(r.voidDelta)) {
      voidDeltaSum += r.voidDelta;
      voidDeltaN++;
    }
    if (typeof r.timeMs === 'number' && Number.isFinite(r.timeMs)) withTimeMs++;
    else missingTimeMs++;
  }
  return {
    rowCount: rows.length,
    byVoidRisk,
    byMaxSeverity,
    byMarketClass,
    byEventType,
    withVoidEv,
    meanVoidDelta: voidDeltaN ? voidDeltaSum / voidDeltaN : null,
    dualStamp: { withTimeMs, missingTimeMs },
  };
}

/** Compact one-liner banner for TTY / markdown headers. */
export function formatAnalyzeBanner(input: {
  sportId: string;
  phase: string;
  sortBy: string[];
  desc?: boolean;
  columns?: readonly string[];
  summary: AnalyzeRowSummary;
  schemaVersion?: number;
}): string {
  const s = input.summary;
  const voidBits = Object.entries(s.byVoidRisk)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
  const colHint = input.columns?.length
    ? ` · cols=${input.columns.length}`
    : '';
  const mean =
    s.meanVoidDelta != null ? ` · mean voidΔ=${s.meanVoidDelta.toFixed(1)}` : '';
  return (
    `settlement + edge patterns · sport=${input.sportId} phase=${input.phase}` +
    ` · sort-by ${input.sortBy.join(',')}${input.desc ? ' desc' : ''}` +
    ` · rows=${s.rowCount}${colHint}` +
    ` · voidRisk[${voidBits || '—'}]` +
    ` · dualStamp=${s.dualStamp.withTimeMs}/${s.rowCount}` +
    mean +
    (input.schemaVersion != null ? ` · schema v${input.schemaVersion}` : '')
  );
}

/** Meta object for --inspect (paired with Bun.inspect + table). */
export function buildAnalyzeInspectMeta(input: {
  sportId: string;
  phase: string;
  sortBy: string[];
  desc: boolean;
  columns: readonly string[];
  rows: AnalyzeWeightedRow[];
  schemaVersion?: number;
}): Record<string, unknown> {
  const summary = summarizeAnalyzeRows(input.rows);
  return {
    schemaVersion: input.schemaVersion ?? 3,
    sportId: input.sportId,
    phase: input.phase,
    sortBy: input.sortBy,
    desc: input.desc,
    rowCount: summary.rowCount,
    columns: [...input.columns],
    columnCount: input.columns.length,
    presets: [...ANALYZE_COLUMN_PRESET_NAMES],
    summary: {
      byVoidRisk: summary.byVoidRisk,
      byMaxSeverity: summary.byMaxSeverity,
      byMarketClass: summary.byMarketClass,
      byEventType: summary.byEventType,
      withVoidEv: summary.withVoidEv,
      meanVoidDelta: summary.meanVoidDelta,
      dualStamp: summary.dualStamp,
    },
  };
}

/**
 * Full or focused markdown report: banner + summary + selected preset table(s).
 *
 * @param presets Which column presets to include. Default = all named presets.
 *   Pass `['desk']` for a focused desk page (CLI `--html --columns=desk`).
 */
export function formatAnalyzeMarkdownReport(input: {
  sportId: string;
  phase: string;
  sortBy: string[];
  desc?: boolean;
  rows: AnalyzeWeightedRow[];
  schemaVersion?: number;
  generatedAt?: string;
  /** Preset names to render; omit for full multi-preset bake. */
  presets?: readonly AnalyzeColumnPresetName[];
  /** Optional column list for a free-form table (when not a single named preset). */
  columns?: readonly string[];
}): string {
  const summary = summarizeAnalyzeRows(input.rows);
  const presetList: AnalyzeColumnPresetName[] = input.presets
    ? [...input.presets]
    : [...ANALYZE_COLUMN_PRESET_NAMES];
  const focused =
    presetList.length === 1 && presetList[0] !== 'all' ? presetList[0]! : null;
  const banner = formatAnalyzeBanner({
    sportId: input.sportId,
    phase: input.phase,
    sortBy: input.sortBy,
    desc: input.desc,
    columns: focused
      ? resolveAnalyzeColumns([focused])
      : input.columns
        ? resolveAnalyzeColumns(input.columns)
        : undefined,
    summary,
    schemaVersion: input.schemaVersion,
  });
  const titleSuffix = focused ? ` · ${focused}` : '';
  const lines: string[] = [
    `# Live-tracker analyze (${input.sportId} / ${input.phase}${titleSuffix})`,
    '',
    input.generatedAt ? `Generated \`${input.generatedAt}\`` : '',
    '',
    banner,
    '',
    '## Summary',
    '',
    formatMarkdownTable(
      [
        { metric: 'rows', value: summary.rowCount },
        { metric: 'with voidEv', value: summary.withVoidEv },
        {
          metric: 'mean voidΔ',
          value: summary.meanVoidDelta != null ? Number(summary.meanVoidDelta.toFixed(3)) : '—',
        },
        {
          metric: 'dual timeMs',
          value: `${summary.dualStamp.withTimeMs}/${summary.rowCount}`,
        },
        {
          metric: 'voidRisk',
          value: Object.entries(summary.byVoidRisk)
            .map(([k, n]) => `${k}:${n}`)
            .join(' · ') || '—',
        },
        {
          metric: 'severity',
          value: Object.entries(summary.byMaxSeverity)
            .map(([k, n]) => `${k}:${n}`)
            .join(' · ') || '—',
        },
        {
          metric: 'marketClass',
          value: Object.entries(summary.byMarketClass)
            .map(([k, n]) => `${k}:${n}`)
            .join(' · ') || '—',
        },
      ],
      ['metric', 'value'],
    ),
    '',
  ];

  // Free-form column list (not a single named preset) → one table section
  if (input.columns?.length && !focused && !(input.presets?.length)) {
    lines.push('## Columns', '', formatAnalyzeMarkdownTable(input.rows, input.columns), '');
  } else {
    const ordered = [
      ...presetList.filter(p => p !== 'all'),
      ...(presetList.includes('all') ? (['all'] as const) : []),
    ];
    for (const name of ordered) {
      lines.push(
        `## Preset \`${name}\``,
        '',
        formatAnalyzeMarkdownTable(input.rows, [name]),
        '',
      );
    }
  }
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/** Operator-grade CSS for analyze HTML (density + sticky header + risk chips). */
export const ANALYZE_HTML_STYLES = `
  :root {
    color-scheme: dark light;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    --risk-high: #ef4444;
    --risk-medium: #f59e0b;
    --risk-low: #22c55e;
    --sev-critical: #dc2626;
    --sev-high: #ea580c;
    --sev-watch: #2563eb;
    --sev-info: #64748b;
    --border: color-mix(in srgb, currentColor 22%, transparent);
    --th-bg: color-mix(in srgb, currentColor 9%, transparent);
    --chip-bg: color-mix(in srgb, currentColor 6%, transparent);
    --surface: color-mix(in srgb, Canvas 92%, transparent);
  }
  body { max-width: 1180px; margin: 1rem auto 2.5rem; padding: 0 0.85rem 2rem; line-height: 1.4; font-size: 14px; }
  h1 { font-size: 1.25rem; margin: 0.5rem 0 0.35rem; letter-spacing: 0.02em; }
  h2 { font-size: 1rem; margin: 1.25rem 0 0.4rem; letter-spacing: 0.02em; scroll-margin-top: 3.25rem; }
  h2:target { outline: 2px solid color-mix(in srgb, currentColor 35%, transparent); outline-offset: 4px; border-radius: 4px; }
  p { margin: 0.35rem 0; }
  .table-wrap { overflow-x: auto; margin: 0.5rem 0 1.25rem; border: 1px solid var(--border); border-radius: 6px; }
  table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 0.78rem; margin: 0; }
  th, td { border-bottom: 1px solid var(--border); padding: 0.28rem 0.45rem; text-align: left; vertical-align: top; white-space: nowrap; max-width: 28rem; overflow: hidden; text-overflow: ellipsis; }
  td:last-child, th:last-child { white-space: normal; max-width: 36rem; }
  th { background: var(--th-bg); position: sticky; top: 0; z-index: 1; font-weight: 600; }
  tr:hover td { background: color-mix(in srgb, currentColor 4%, transparent); }
  code { font-size: 0.88em; }
  .badge { display: inline-block; padding: 0.12rem 0.45rem; border-radius: 999px; background: var(--chip-bg); border: 1px solid var(--border); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .meta-footer { margin-top: 1.5rem; padding-top: 0.75rem; border-top: 1px solid var(--border); font-size: 0.75rem; opacity: 0.85; }
  .meta-footer code { user-select: all; }
  .risk-high, .sev-high, .sev-critical { color: var(--risk-high); font-weight: 600; }
  .risk-medium { color: var(--risk-medium); font-weight: 600; }
  .risk-low { color: var(--risk-low); font-weight: 600; }
  .sev-watch { color: var(--sev-watch); font-weight: 600; }
  .sev-info { color: var(--sev-info); }
  tr.row-risk-high td { background: color-mix(in srgb, var(--risk-high) 9%, transparent); }
  tr.row-risk-medium td { background: color-mix(in srgb, var(--risk-medium) 8%, transparent); }
  tr.row-risk-low td { background: color-mix(in srgb, var(--risk-low) 7%, transparent); }
  .preset-nav {
    display: flex; flex-wrap: wrap; gap: 0.4rem;
    position: sticky; top: 0; z-index: 3;
    margin: 0.6rem 0 0.85rem; padding: 0.45rem 0.35rem;
    background: var(--surface);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--border);
  }
  .preset-nav a { text-decoration: none; padding: 0.2rem 0.55rem; border-radius: 999px; border: 1px solid var(--border); font-size: 0.75rem; font-weight: 600; color: inherit; background: var(--chip-bg); }
  .preset-nav a:hover { border-color: color-mix(in srgb, currentColor 45%, transparent); }
  .sort-hint { font-size: 0.75rem; opacity: 0.8; margin: 0.2rem 0 0.5rem; }
  .summary-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.35rem 0 0.75rem; }
  .summary-chips .chip {
    display: inline-flex; align-items: center; gap: 0.25rem;
    padding: 0.15rem 0.5rem; border-radius: 999px;
    border: 1px solid var(--border); font-size: 0.72rem; font-weight: 600;
    background: var(--chip-bg);
  }
  .summary-chips .chip .n { opacity: 0.75; font-variant-numeric: tabular-nums; }
  .chip-risk-high { color: var(--risk-high); border-color: color-mix(in srgb, var(--risk-high) 45%, transparent); }
  .chip-risk-medium { color: var(--risk-medium); border-color: color-mix(in srgb, var(--risk-medium) 45%, transparent); }
  .chip-risk-low { color: var(--risk-low); border-color: color-mix(in srgb, var(--risk-low) 45%, transparent); }
  .chip-sev-critical, .chip-sev-high { color: var(--risk-high); }
  .chip-sev-watch { color: var(--sev-watch); }
  .chip-sev-info { color: var(--sev-info); }
  .chip-meta { opacity: 0.9; }
`.trim();

/**
 * Highlight voidRisk / severity cells + tint whole rows after Bun.markdown.html.
 * Conservative: only bare cells whose entire text is a known token.
 */
export function enhanceAnalyzeHtmlBody(bodyHtml: string): string {
  const tokens: Array<[string, string]> = [
    ['critical', 'sev-critical'],
    ['high', 'risk-high'],
    ['medium', 'risk-medium'],
    ['low', 'risk-low'],
    ['watch', 'sev-watch'],
    ['info', 'sev-info'],
  ];
  let out = bodyHtml;
  for (const [token, cls] of tokens) {
    const re = new RegExp(`<td(\\s[^>]*)?>${token}<\\/td>`, 'gi');
    out = out.replace(re, `<td$1 class="${cls}">${token}</td>`);
  }
  // Row tint from highest-priority risk token present in the row
  out = out.replace(/<tr>([\s\S]*?)<\/tr>/gi, (full, inner: string) => {
    if (/class="risk-high"/i.test(inner) || /class='risk-high'/i.test(inner)) {
      return `<tr class="row-risk-high">${inner}</tr>`;
    }
    if (/class="risk-medium"/i.test(inner) || /class='risk-medium'/i.test(inner)) {
      return `<tr class="row-risk-medium">${inner}</tr>`;
    }
    if (/class="risk-low"/i.test(inner) || /class='risk-low'/i.test(inner)) {
      return `<tr class="row-risk-low">${inner}</tr>`;
    }
    return full;
  });
  // Wrap each table for sticky + scroll
  out = out.replace(/<table>/gi, '<div class="table-wrap"><table>').replace(
    /<\/table>/gi,
    '</table></div>',
  );
  return out;
}

/** Jump nav for multi-preset HTML reports. */
export function buildAnalyzePresetNav(
  presets: readonly AnalyzeColumnPresetName[],
): string {
  const links = presets
    .filter(p => p !== 'all' || presets.length === 1)
    .map(p => {
      const id = p === 'all' ? 'preset-all' : `preset-${p}`;
      return `<a href="#${id}">${p}</a>`;
    });
  if (links.length < 2) return '';
  return `<nav class="preset-nav" aria-label="Column presets">${links.join('')}</nav>\n`;
}

function chipClassForToken(kind: 'risk' | 'sev' | 'meta', token: string): string {
  const t = token.toLowerCase();
  if (kind === 'risk') {
    if (t === 'high') return 'chip chip-risk-high';
    if (t === 'medium') return 'chip chip-risk-medium';
    if (t === 'low') return 'chip chip-risk-low';
  }
  if (kind === 'sev') {
    if (t === 'critical') return 'chip chip-sev-critical';
    if (t === 'high') return 'chip chip-sev-high';
    if (t === 'watch') return 'chip chip-sev-watch';
    if (t === 'info') return 'chip chip-sev-info';
  }
  return 'chip chip-meta';
}

/**
 * Compact HTML chip strip for voidRisk / severity / dual-stamp (above tables).
 */
export function buildAnalyzeSummaryChipsHtml(summary: AnalyzeRowSummary): string {
  const chips: string[] = [];
  chips.push(
    `<span class="chip chip-meta">rows <span class="n">${summary.rowCount}</span></span>`,
  );
  for (const [k, n] of Object.entries(summary.byVoidRisk).sort((a, b) => b[1] - a[1])) {
    chips.push(
      `<span class="${chipClassForToken('risk', k)}">void ${k} <span class="n">${n}</span></span>`,
    );
  }
  for (const [k, n] of Object.entries(summary.byMaxSeverity).sort((a, b) => b[1] - a[1])) {
    chips.push(
      `<span class="${chipClassForToken('sev', k)}">sev ${k} <span class="n">${n}</span></span>`,
    );
  }
  if (summary.meanVoidDelta != null) {
    chips.push(
      `<span class="chip chip-meta">mean voidΔ <span class="n">${summary.meanVoidDelta.toFixed(1)}</span></span>`,
    );
  }
  chips.push(
    `<span class="chip chip-meta">dual <span class="n">${summary.dualStamp.withTimeMs}/${summary.rowCount}</span></span>`,
  );
  return `<div class="summary-chips" aria-label="Row summary">${chips.join('')}</div>\n`;
}

/** Wrap markdown body in a minimal standalone HTML document. */
export function wrapAnalyzeHtmlDocument(input: {
  sportId: string;
  phase: string;
  titleExtra?: string;
  bodyHtml: string;
  /** Optional footer: recipe command + focus badge. */
  footer?: { recipe?: string; focusLabel?: string };
  /** Multi-preset jump links (already HTML). */
  navHtml?: string;
  /** Pipeline hint under title (sort / filter / limit). */
  sortHint?: string;
  /** Pre-built summary chip strip. */
  chipsHtml?: string;
  /** Watch-tick delta chips (optional). */
  deltaChipsHtml?: string;
  /**
   * Browser auto-reload interval (seconds). Used with analyze `--watch --html`
   * so the written file refreshes without re-open.
   */
  autoRefreshSec?: number;
  /** ISO generated-at shown next to refresh chip. */
  generatedAt?: string;
}): string {
  const titleExtra = input.titleExtra ? ` · ${input.titleExtra}` : '';
  const enhanced = enhanceAnalyzeHtmlBody(input.bodyHtml);
  const badge = input.footer?.focusLabel
    ? `<p><span class="badge">${input.footer.focusLabel}</span></p>\n`
    : '';
  const sortHint = input.sortHint
    ? `<p class="sort-hint">Pipeline: ${input.sortHint}</p>\n`
    : '';
  const refreshSec =
    typeof input.autoRefreshSec === 'number' &&
    Number.isFinite(input.autoRefreshSec) &&
    input.autoRefreshSec > 0
      ? Math.max(1, Math.floor(input.autoRefreshSec))
      : undefined;
  const refreshMeta = refreshSec
    ? `<meta http-equiv="refresh" content="${refreshSec}" />\n`
    : '';
  const liveBits: string[] = [];
  if (input.generatedAt) {
    liveBits.push(
      `<span class="chip chip-meta">as of <span class="n">${input.generatedAt}</span></span>`,
    );
  }
  if (refreshSec != null) {
    liveBits.push(
      `<span class="chip chip-meta" title="meta refresh">auto-refresh ${refreshSec}s</span>`,
    );
  }
  const liveBar = liveBits.length
    ? `<div class="summary-chips" aria-label="Live status">${liveBits.join('')}</div>\n`
    : '';
  const delta = input.deltaChipsHtml ?? '';
  const chips = input.chipsHtml ?? '';
  const nav = input.navHtml ?? '';
  const recipe = input.footer?.recipe
    ? `<div class="meta-footer">Recipe: <code>${input.footer.recipe}</code></div>\n`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${refreshMeta}<title>Live-tracker analyze · ${input.sportId} / ${input.phase}${titleExtra}</title>
<style>
${ANALYZE_HTML_STYLES}
</style>
</head>
<body>
${badge}${sortHint}${liveBar}${delta}${chips}${nav}${enhanced}
${recipe}</body>
</html>
`;
}

/**
 * HTML report via Bun.markdown.html (docs preset: GFM + heading ids + tagFilter).
 * Pass `presets: ['desk']` for a focused single-preset page.
 */
export function formatAnalyzeHtmlReport(input: {
  sportId: string;
  phase: string;
  sortBy: string[];
  desc?: boolean;
  rows: AnalyzeWeightedRow[];
  schemaVersion?: number;
  generatedAt?: string;
  presets?: readonly AnalyzeColumnPresetName[];
  columns?: readonly string[];
  /** When true, append CLI recipe footer. */
  includeRecipe?: boolean;
  /** Displayed under title (pipeline applied to `rows` by caller). */
  rowSortHint?: string;
  /** Extra recipe fragments (`--void-risk=high` …). */
  recipeExtra?: string[];
  /** Inject `<meta http-equiv="refresh">` for watch-mode HTML. */
  autoRefreshSec?: number;
  /** Optional watch-tick delta for chips. */
  delta?: AnalyzeDisplayDelta | null;
}): string {
  const md = formatAnalyzeMarkdownReport(input);
  const body = markdownToHtml(md, 'docs');
  const focused =
    input.presets?.length === 1 && input.presets[0] !== 'all' ? input.presets[0] : undefined;
  const multi =
    input.presets && input.presets.length > 1
      ? input.presets.filter(p => p !== 'all').join('+')
      : undefined;
  const focusLabel = focused ?? multi;
  const navPresets: AnalyzeColumnPresetName[] =
    input.presets && input.presets.length > 1
      ? [...input.presets]
      : !input.presets || input.presets.includes('all')
        ? [...ANALYZE_COLUMN_PRESET_NAMES]
        : [];
  const summary = summarizeAnalyzeRows(input.rows);
  const recipe =
    input.includeRecipe !== false
      ? buildAnalyzeHtmlRecipe({
          sportId: input.sportId,
          phase: input.phase,
          columns: focused
            ? [focused]
            : multi
              ? input.presets!.filter(p => p !== 'all')
              : input.presets?.includes('all')
                ? ['all']
                : input.columns,
          extra: input.recipeExtra,
        })
      : undefined;
  return wrapAnalyzeHtmlDocument({
    sportId: input.sportId,
    phase: input.phase,
    titleExtra: focusLabel,
    bodyHtml: body,
    footer: { recipe, focusLabel },
    navHtml: buildAnalyzePresetNav(navPresets),
    sortHint: input.rowSortHint,
    chipsHtml: buildAnalyzeSummaryChipsHtml(summary),
    deltaChipsHtml: input.delta ? buildAnalyzeDeltaChipsHtml(input.delta) : undefined,
    autoRefreshSec: input.autoRefreshSec,
    generatedAt: input.generatedAt,
  });
}

/** CLI recipe string for HTML footers. */
export function buildAnalyzeHtmlRecipe(input: {
  sportId: string;
  phase: string;
  columns?: readonly string[];
  /** Additional flags already formatted (`--void-risk=high`). */
  extra?: readonly string[];
}): string {
  const cols = input.columns?.length ? input.columns.join(',') : 'desk';
  const extras = input.extra?.length ? ` ${input.extra.join(' ')}` : '';
  return `bun live-tracker.ts analyze --sport=${input.sportId} --phase=${input.phase} --columns=${cols}${extras} --html`;
}

/** Detect a single named column preset from --columns args. */
export function detectAnalyzeFocusPreset(
  columns?: readonly string[],
): AnalyzeColumnPresetName | null {
  if (!columns?.length) return null;
  if (columns.length !== 1) return null;
  const only = columns[0]!;
  if ((ANALYZE_COLUMN_PRESET_NAMES as readonly string[]).includes(only)) {
    return only as AnalyzeColumnPresetName;
  }
  return null;
}

export type HtmlPresetResolution =
  | { kind: 'full' }
  | { kind: 'presets'; presets: AnalyzeColumnPresetName[] }
  | { kind: 'fields'; fields: string[] };

/**
 * Resolve --columns for HTML:
 * - empty / all → full multi-preset
 * - one or more named presets (desk,ev) → those sections only
 * - free-form field keys → single Columns table
 */
export function resolveHtmlPresets(columns?: readonly string[]): HtmlPresetResolution {
  if (!columns?.length) return { kind: 'full' };
  if (columns.length === 1 && columns[0] === 'all') return { kind: 'full' };
  const presetSet = new Set<string>(ANALYZE_COLUMN_PRESET_NAMES);
  const allPresets = columns.every(c => presetSet.has(c));
  if (allPresets) {
    const presets = columns.filter(c => c !== 'all') as AnalyzeColumnPresetName[];
    if (!presets.length) return { kind: 'full' };
    return { kind: 'presets', presets };
  }
  return { kind: 'fields', fields: [...columns] };
}

export type AnalyzeSnapshotArtifact = {
  schemaVersion: 3;
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
  summary: AnalyzeRowSummary;
  rows: AnalyzeWeightedRow[];
  /** Desk-preset markdown for human skim. */
  markdownDesk: string;
  /** Full multi-preset markdown report body. */
  markdownReport: string;
  generatedAt: string;
};

export function buildAnalyzeSchemaDocument() {
  return buildTableSchemaDocument({
    schemaVersion: 3,
    description:
      'Flat row schema for live-tracker analyze --sport (settlement + edge patterns). Column presets: desk | odds | settlement | patterns | ev | all. Includes row summary aggregates and multi-preset markdown/HTML bake.',
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
  const generatedAt = new Date().toISOString();
  const summary = summarizeAnalyzeRows(rows);
  return {
    schemaVersion: 3,
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
    summary,
    rows,
    markdownDesk: formatAnalyzeMarkdownTable(rows, ANALYZE_WEIGHTED_DEFAULT_COLUMNS),
    markdownReport: formatAnalyzeMarkdownReport({
      sportId: input.sportId,
      phase: input.phase,
      sortBy: input.sortBy,
      desc: input.desc,
      rows,
      schemaVersion: 3,
      generatedAt,
    }),
    generatedAt,
  };
}

/**
 * Pure end-to-end sport analyze render bundle for CLI + recipe tests.
 * Call after {@link weightTrackerEvents} (or with pre-weighted events).
 */
export type SportAnalyzeRender = {
  artifact: AnalyzeSnapshotArtifact;
  columns: AnalyzeWeightedFieldKey[];
  /** Single named preset when --columns=desk|odds|…; null for free-form / all. */
  focusPreset: AnalyzeColumnPresetName | null;
  banner: string;
  inspectMeta: Record<string, unknown>;
  tableInspect: string;
  tableMarkdown: string;
  /** Full multi-preset report (bake sample.md). */
  markdownReport: string;
  /** Full multi-preset HTML (bake sample.html). */
  htmlReport: string;
  /**
   * HTML for CLI `--html`: honors --columns.
   * - one named preset (e.g. desk) → focused page (summary + that preset only)
   * - all / free-form → full multi-preset or columns table
   */
  htmlView: string;
  /** Watch-tick delta vs `prevRows` (null on first tick / when omitted). */
  delta: AnalyzeDisplayDelta | null;
};

export function renderSportAnalyze(input: {
  sportId: string;
  phase: string;
  sortBy: string[];
  desc?: boolean;
  events: WeightedTrackerEvent[];
  /** Preset name(s) and/or field keys — same as CLI --columns. */
  columns?: readonly string[];
  colors?: boolean;
  /**
   * Display row order (table/HTML/CSV). When omitted, uses
   * {@link defaultRowSortForPreset} from the focus preset.
   */
  rowSortBy?: AnalyzeRowSortKey | AnalyzeRowSortKey[];
  rowSortDesc?: boolean;
  /** Allowlist filters before sort/limit. */
  rowFilter?: AnalyzeRowFilter;
  /** Top-N after sort (omit = all). */
  rowLimit?: number;
  /** HTML meta refresh (seconds) for watch-mode desks. */
  autoRefreshSec?: number;
  /** Previous display rows for watch-tick delta. */
  prevRows?: readonly AnalyzeWeightedRow[] | null;
  prevSummary?: AnalyzeRowSummary | null;
}): SportAnalyzeRender {
  const desc = input.desc ?? false;
  const artifact = buildAnalyzeSnapshotArtifact({
    sportId: input.sportId,
    phase: input.phase,
    sortBy: input.sortBy,
    desc,
    events: input.events,
  });
  const columns = resolveAnalyzeColumns(input.columns);
  const focusPreset = detectAnalyzeFocusPreset(input.columns);
  const htmlSel = resolveHtmlPresets(input.columns);
  const defaultSort =
    focusPreset && focusPreset !== 'all'
      ? defaultRowSortForPreset(focusPreset)
      : htmlSel.kind === 'presets' && htmlSel.presets.includes('ev')
        ? defaultRowSortForPreset('ev')
        : defaultRowSortForPreset(null);
  const rowSortBy = input.rowSortBy ?? defaultSort.sortBy;
  const rowSortDesc = input.rowSortDesc ?? defaultSort.desc;
  const pipeline = pipelineAnalyzeRows(artifact.rows, {
    filter: input.rowFilter,
    sortBy: rowSortBy,
    desc: rowSortDesc,
    limit: input.rowLimit,
  });
  const displayRows = pipeline.rows;
  const displaySummary = summarizeAnalyzeRows(displayRows);
  const rowSortHint = pipeline.hint;
  const delta = diffAnalyzeDisplay(input.prevRows, displayRows, {
    prevSummary: input.prevSummary,
    nextSummary: displaySummary,
  });
  const recipeExtra = buildAnalyzeRecipeExtras({
    rowSortBy,
    rowSortDesc,
    rowFilter: input.rowFilter,
    rowLimit: input.rowLimit,
    usedDefaultSort: input.rowSortBy == null,
    autoRefreshSec: input.autoRefreshSec,
  });
  const banner = formatAnalyzeBanner({
    sportId: artifact.sportId,
    phase: artifact.phase,
    sortBy: artifact.sortBy,
    desc: artifact.desc,
    columns,
    summary: displaySummary,
    schemaVersion: artifact.schemaVersion,
  });
  const deltaSuffix = delta ? ` · ${delta.hint}` : '';
  const inspectMeta = {
    ...buildAnalyzeInspectMeta({
      sportId: artifact.sportId,
      phase: artifact.phase,
      sortBy: artifact.sortBy,
      desc: artifact.desc,
      columns,
      rows: displayRows,
      schemaVersion: artifact.schemaVersion,
    }),
    rowSort: { sortBy: rowSortBy, desc: rowSortDesc },
    rowFilter: input.rowFilter ?? {},
    rowLimit: input.rowLimit ?? null,
    pipeline: rowSortHint,
    sourceRowCount: artifact.summary.rowCount,
    autoRefreshSec: input.autoRefreshSec ?? null,
    delta,
  };
  const htmlBase = {
    sportId: artifact.sportId,
    phase: artifact.phase,
    sortBy: artifact.sortBy,
    desc: artifact.desc,
    rows: displayRows,
    schemaVersion: artifact.schemaVersion,
    generatedAt: artifact.generatedAt,
    rowSortHint,
    recipeExtra,
    autoRefreshSec: input.autoRefreshSec,
    delta,
  };
  const htmlReport = formatAnalyzeHtmlReport(htmlBase);
  // HTML view honors --columns: one/more named presets, free-form fields, or full
  const htmlView =
    htmlSel.kind === 'full'
      ? htmlReport
      : htmlSel.kind === 'presets'
        ? formatAnalyzeHtmlReport({
            ...htmlBase,
            presets: htmlSel.presets,
          })
        : formatAnalyzeHtmlReport({
            ...htmlBase,
            columns: htmlSel.fields,
          });
  return {
    artifact: {
      ...artifact,
      rows: displayRows,
      summary: displaySummary,
    },
    columns,
    focusPreset,
    banner: `${banner} · ${rowSortHint}${deltaSuffix}`,
    inspectMeta,
    tableInspect: formatAnalyzeInspectTable(displayRows, columns, {
      colors: input.colors ?? false,
    }),
    tableMarkdown: formatAnalyzeMarkdownTable(displayRows, columns),
    markdownReport: formatAnalyzeMarkdownReport({
      sportId: artifact.sportId,
      phase: artifact.phase,
      sortBy: artifact.sortBy,
      desc: artifact.desc,
      rows: displayRows,
      schemaVersion: artifact.schemaVersion,
      generatedAt: artifact.generatedAt,
    }),
    htmlReport,
    htmlView,
    delta,
  };
}

/** Build CLI flag fragments for recipe footer (skip pure defaults). */
export function buildAnalyzeRecipeExtras(input: {
  rowSortBy: AnalyzeRowSortKey | AnalyzeRowSortKey[];
  rowSortDesc: boolean;
  rowFilter?: AnalyzeRowFilter;
  rowLimit?: number;
  usedDefaultSort: boolean;
  autoRefreshSec?: number;
}): string[] {
  const extra: string[] = [];
  const f = input.rowFilter;
  if (f?.voidRisk?.length) extra.push(`--void-risk=${f.voidRisk.join(',')}`);
  if (f?.maxSeverity?.length) extra.push(`--max-severity=${f.maxSeverity.join(',')}`);
  if (f?.marketClass?.length) extra.push(`--market-class=${f.marketClass.join(',')}`);
  if (f?.eventType?.length) extra.push(`--event-type=${f.eventType.join(',')}`);
  if (f?.marketType?.length) extra.push(`--market-type=${f.marketType.join(',')}`);
  if (f?.period?.length) extra.push(`--periods=${f.period.join(',')}`);
  if (f?.eventId?.length) extra.push(`--event-id=${f.eventId.join(',')}`);
  if (f?.pattern?.length) extra.push(`--pattern=${f.pattern.join(',')}`);
  if (f?.patternFamily?.length) extra.push(`--pattern-family=${f.patternFamily.join(',')}`);
  if (f?.hasEye) extra.push('--has-eye');
  if (f?.sinceMs != null) extra.push(`--since=${new Date(f.sinceMs).toISOString()}`);
  if (f?.untilMs != null) extra.push(`--until=${new Date(f.untilMs).toISOString()}`);
  if (!input.usedDefaultSort) {
    const keys = Array.isArray(input.rowSortBy) ? input.rowSortBy : [input.rowSortBy];
    extra.push(`--sort-rows=${keys.join(',')}`);
  }
  if (input.rowSortDesc) extra.push('--rows-desc');
  if (typeof input.rowLimit === 'number' && Number.isFinite(input.rowLimit)) {
    extra.push(`--limit=${Math.floor(input.rowLimit)}`);
  }
  if (
    typeof input.autoRefreshSec === 'number' &&
    Number.isFinite(input.autoRefreshSec) &&
    input.autoRefreshSec > 0
  ) {
    extra.push('--watch');
  }
  return extra;
}

/**
 * Resolve multi-format bundle paths from an output stem.
 * `desk.html` → desk.html / desk.csv / desk.md; `desk` → desk.html / …
 */
export function resolveAnalyzeBundlePaths(stemOrPath: string): {
  html: string;
  csv: string;
  md: string;
  stem: string;
} {
  const raw = stemOrPath.replace(/\/+$/, '');
  const stem = raw.replace(/\.(html?|csv|md)$/i, '');
  return {
    stem,
    html: `${stem}.html`,
    csv: `${stem}.csv`,
    md: `${stem}.md`,
  };
}
