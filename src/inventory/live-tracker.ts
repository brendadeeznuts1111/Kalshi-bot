/**
 * Live market event tracker — normalize Pandora offer transitions into a
 * stable event log (MARKET_ADDED / MARKET_REMOVED / PRICE_CHANGE / …).
 *
 * Used by `tools/live-tracker-cli.ts` CLI (moved from root `live-tracker.ts`): diff · watch · analyze.
 */
import type {
  EventDataStateTransition,
  OfferTransition,
} from '../partner/fantasy-ultra/coefficients.ts';
import { dualTime, sortKeyEpochMs, type EpochMs, type IsoUtc } from '../lib/time-ssot.ts';
import { parseJsonlText } from '../lib/jsonl.ts';
import {
  weightLiveTrackerMove,
  type EdgePatternSortOptions,
  type LiveTrackerWeightResult,
  type SettlementPhase,
} from '../settlement/index.ts';
import { CACHE_DIR, joinPath } from '../research/paths.ts';
import type { OddsWatchUpdate } from './pandora-listen.ts';

/** Stable public event kinds for CLI filters. */
export const LIVE_TRACKER_EVENT_TYPES = [
  'MARKET_ADDED',
  'MARKET_REMOVED',
  'SELECTION_ADDED',
  'SELECTION_REMOVED',
  'PRICE_CHANGE',
  'EVENT_STATE',
  'LINES_FLAG',
  'EVENT_REMOVED',
  'WATCH_TICK',
] as const;

type LiveTrackerEventType = (typeof LIVE_TRACKER_EVENT_TYPES)[number];

export type LiveTrackerEvent = {
  /** ISO-8601 UTC wall clock. */
  time: IsoUtc | string;
  /**
   * Same instant as Unix epoch **milliseconds** (join to shadow/event-store).
   * Filled at mint; backfilled on load when missing.
   */
  timeMs?: EpochMs | null;
  eventType: LiveTrackerEventType;
  /** Pandora event id (wire). */
  eventId: number | string;
  period?: string;
  marketType?: string;
  selection?: string;
  detail: string;
  from?: number | string | null;
  to?: number | string | null;
  /** Source log path when loaded from disk. */
  file?: string | undefined;
  /** Raw kind from OfferTransition / eventData. */
  rawKind?: string;
};

type LiveTrackerLogRecord = {
  /** ISO-8601 UTC. */
  at: string;
  /** Epoch ms for `at` when known. */
  atMs?: EpochMs | null;
  eventId: number;
  lineCount: number;
  offeredMarketCount: number;
  events: LiveTrackerEvent[];
};

/** Stamp dual time onto an event (mint or load backfill). */
export function withDualTime<T extends { time: string; timeMs?: EpochMs | null }>(
  e: T,
): T & { time: string; timeMs: EpochMs | null } {
  if (e.timeMs != null && Number.isFinite(e.timeMs)) {
    return e as T & { time: string; timeMs: EpochMs | null };
  }
  const d = dualTime(e.time);
  return { ...e, time: d?.time ?? e.time, timeMs: d?.timeMs ?? null };
}

function ctxDual(at: string): { at: string; atMs: EpochMs | null; time: string; timeMs: EpochMs | null } {
  const d = dualTime(at);
  return {
    at: d?.time ?? at,
    atMs: d?.timeMs ?? null,
    time: d?.time ?? at,
    timeMs: d?.timeMs ?? null,
  };
}

export const LIVE_TRACKER_LOG_DIR = joinPath(CACHE_DIR, 'live-tracker');

export function defaultLiveTrackerLogPath(eventId: number | string): string {
  return joinPath(LIVE_TRACKER_LOG_DIR, `event-${eventId}.jsonl`);
}

function offerTransitionToEvent(
  t: OfferTransition,
  ctx: { at: string; eventId: number; file?: string | undefined; timeMs?: EpochMs | null }
): LiveTrackerEvent {
  const dual = ctx.timeMs != null ? { time: ctx.at, timeMs: ctx.timeMs } : dualTime(ctx.at);
  const base = {
    time: dual?.time ?? ctx.at,
    timeMs: dual?.timeMs ?? null,
    eventId: ctx.eventId,
    period: t.period,
    marketType: t.marketType,
    file: ctx.file,
    rawKind: t.kind,
  };
  switch (t.kind) {
    case 'market_on':
      return {
        ...base,
        eventType: 'MARKET_ADDED',
        detail: `market ${t.period}/${t.marketType} offered`,
      };
    case 'market_off':
      return {
        ...base,
        eventType: 'MARKET_REMOVED',
        detail: `market ${t.period}/${t.marketType} empty/off`,
      };
    case 'selection_on':
      return {
        ...base,
        eventType: 'SELECTION_ADDED',
        selection: t.selection,
        detail: `sel ${t.period}/${t.marketType}/${t.selection} on`,
      };
    case 'selection_off':
      return {
        ...base,
        eventType: 'SELECTION_REMOVED',
        selection: t.selection,
        detail: `sel ${t.period}/${t.marketType}/${t.selection} off`,
      };
    case 'price_change':
      return {
        ...base,
        eventType: 'PRICE_CHANGE',
        selection: t.selection,
        from: t.from,
        to: t.to,
        detail: `price ${t.period}/${t.marketType}/${t.selection} ${t.from}→${t.to}`,
      };
  }
}

function eventDataTransitionToEvent(
  t: EventDataStateTransition,
  ctx: { at: string; eventId: number; file?: string | undefined; timeMs?: EpochMs | null }
): LiveTrackerEvent {
  const dual = ctx.timeMs != null ? { time: ctx.at, timeMs: ctx.timeMs } : dualTime(ctx.at);
  const base = {
    time: dual?.time ?? ctx.at,
    timeMs: dual?.timeMs ?? null,
    eventId: ctx.eventId,
    file: ctx.file,
    rawKind: t.kind,
  };
  if (t.kind === 'lines_flag') {
    return {
      ...base,
      eventType: 'LINES_FLAG',
      to: t.hasLines ? 'true' : 'false',
      detail: `hasLines=${t.hasLines}`,
    };
  }
  if (t.kind === 'event_removed') {
    return {
      ...base,
      eventType: 'EVENT_REMOVED',
      detail: 'event removed from eventData board',
    };
  }
  return {
    ...base,
    eventType: 'EVENT_STATE',
    from: t.from != null ? JSON.stringify(t.from) : null,
    to: t.to != null ? JSON.stringify(t.to) : null,
    detail: `${t.field}: ${JSON.stringify(t.from)}→${JSON.stringify(t.to)}`,
  };
}

/** Flatten a watch update into tracker events (empty if only heartbeat). */
export function eventsFromWatchUpdate(
  u: OddsWatchUpdate,
  options: { includeTicks?: boolean | undefined; file?: string | undefined } = {}
): LiveTrackerEvent[] {
  const stamped = ctxDual(u.at);
  const ctx = {
    at: stamped.at,
    timeMs: stamped.timeMs,
    eventId: u.eventId,
    file: options.file,
  };
  const out: LiveTrackerEvent[] = [];
  for (const t of u.transitions) {
    out.push(offerTransitionToEvent(t, ctx));
  }
  for (const t of u.eventTransitions) {
    out.push(eventDataTransitionToEvent(t, ctx));
  }
  if (options.includeTicks && out.length === 0) {
    out.push({
      time: stamped.time,
      timeMs: stamped.timeMs,
      eventType: 'WATCH_TICK',
      eventId: u.eventId,
      detail: `lines=${u.lineCount} offered=${u.offeredMarketCount}`,
      file: options.file,
    });
  }
  return out;
}

export function parseEventType(raw: string): LiveTrackerEventType | null {
  const u = raw.trim().toUpperCase().replace(/-/g, '_');
  // aliases from internal kinds
  const aliases: Record<string, LiveTrackerEventType> = {
    MARKET_ON: 'MARKET_ADDED',
    MARKET_OFF: 'MARKET_REMOVED',
    SELECTION_ON: 'SELECTION_ADDED',
    SELECTION_OFF: 'SELECTION_REMOVED',
    MARKET_ADDED: 'MARKET_ADDED',
    MARKET_REMOVED: 'MARKET_REMOVED',
    SELECTION_ADDED: 'SELECTION_ADDED',
    SELECTION_REMOVED: 'SELECTION_REMOVED',
    PRICE_CHANGE: 'PRICE_CHANGE',
    EVENT_STATE: 'EVENT_STATE',
    LINES_FLAG: 'LINES_FLAG',
    EVENT_REMOVED: 'EVENT_REMOVED',
    WATCH_TICK: 'WATCH_TICK',
  };
  return aliases[u] ?? null;
}

type SortKey = 'time' | 'event' | 'type' | 'detail' | 'file' | 'eventid';

type DiffQuery = {
  /** One or more event types (OR filter). */
  eventTypes?: LiveTrackerEventType[];
  /** @deprecated use eventTypes */
  eventType?: LiveTrackerEventType | null;
  eventId?: string | number | null;
  marketType?: string | null;
  period?: string | null;
  /** Single key or multi-key (time,event). */
  sortBy?: SortKey | SortKey[];
  desc?: boolean;
  limit?: number;
  offset?: number;
  /** Keep only last N after sort (like tail). Applied after offset/limit chain: sort → offset → limit, unless tail set then sort desc time → limit. */
  tail?: number;
  columns?: string[];
};

function sortKeyValue(e: LiveTrackerEvent, key: SortKey): string {
  switch (key) {
    case 'time':
      return e.time;
    case 'event':
    case 'type':
      return e.eventType;
    case 'detail':
      return e.detail;
    case 'file':
      return e.file ?? '';
    case 'eventid':
      return String(e.eventId);
    default:
      return e.time;
  }
}

export function filterAndSortEvents(
  events: LiveTrackerEvent[],
  q: DiffQuery
): LiveTrackerEvent[] {
  let rows = events;
  const types =
    q.eventTypes?.length
      ? q.eventTypes
      : q.eventType
        ? [q.eventType]
        : null;
  if (types?.length) {
    const set = new Set(types);
    rows = rows.filter(e => set.has(e.eventType));
  }
  if (q.eventId != null && String(q.eventId).trim() !== '') {
    const id = String(q.eventId).replace(/^#/, '');
    rows = rows.filter(e => String(e.eventId) === id);
  }
  if (q.marketType) {
    rows = rows.filter(e => e.marketType === q.marketType);
  }
  if (q.period) {
    rows = rows.filter(e => e.period === q.period);
  }

  // --tail: most recent N by time (ignore other sort for selection)
  if (q.tail != null && q.tail > 0) {
    rows = [...rows].sort((a, b) => b.time.localeCompare(a.time)).slice(0, q.tail);
    // present oldest→newest unless --desc
    if (!q.desc) rows = rows.reverse();
    return rows;
  }

  const sortKeys: SortKey[] = Array.isArray(q.sortBy)
    ? q.sortBy
    : q.sortBy
      ? [q.sortBy]
      : ['time'];
  const dir = q.desc ? -1 : 1;
  rows = [...rows].sort((a, b) => {
    for (const key of sortKeys) {
      const cmp = sortKeyValue(a, key).localeCompare(sortKeyValue(b, key));
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });

  const offset = q.offset != null && q.offset > 0 ? q.offset : 0;
  if (offset) rows = rows.slice(offset);
  if (q.limit != null && q.limit > 0) {
    rows = rows.slice(0, q.limit);
  }
  return rows;
}

function summarizeEventTypes(
  events: LiveTrackerEvent[]
): Array<{ eventType: string; count: number }> {
  const m = new Map<string, number>();
  for (const e of events) {
    m.set(e.eventType, (m.get(e.eventType) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count || a.eventType.localeCompare(b.eventType));
}

/**
 * Annotate PRICE_CHANGE (and other priced) tracker events with shell settlement
 * weighting (void risk, action threshold, three-way EV sketch).
 */
export function weightTrackerEvents(
  events: LiveTrackerEvent[],
  options: {
    sportId: string;
    phase?: SettlementPhase;
    /** Default period when event omits it. */
    period?: string;
    /** Pattern hit sort: family | severity | id */
    patternSort?: EdgePatternSortOptions;
  }
): Array<LiveTrackerEvent & { settlement?: LiveTrackerWeightResult }> {
  const phase = options.phase ?? 'live';
  return events.map(e => {
    const stamped = withDualTime(e);
    if (e.eventType !== 'PRICE_CHANGE' && e.eventType !== 'MARKET_ADDED') {
      return stamped;
    }
    const toNum = e.to != null && e.to !== '' ? Number(e.to) : NaN;
    const settlement = weightLiveTrackerMove({
      sportId: options.sportId,
      phase,
      ...(e.marketType !== undefined ? { marketType: e.marketType } : {}),
      period: e.period ?? options.period ?? 'm',
      decimalOdds: Number.isFinite(toNum) && toNum > 1 ? toNum : null,
      ...(options.patternSort !== undefined ? { patternSort: options.patternSort } : {}),
    });
    return { ...stamped, settlement };
  });
}

type EventTimeStats = {
  total: number;
  byType: Array<{ eventType: string; count: number }>;
  /** ISO of earliest/latest (from dual stamp). */
  minTime: string | null;
  maxTime: string | null;
  /** Epoch ms bounds. */
  minTimeMs: number | null;
  maxTimeMs: number | null;
  /** Span in milliseconds. */
  spanMs: number | null;
  /** Mean gap between consecutive events (ms), when ≥2 events. */
  meanGapMs: number | null;
  minGapMs: number | null;
  maxGapMs: number | null;
};

export function computeEventStats(events: LiveTrackerEvent[]): EventTimeStats {
  const byType = summarizeEventTypes(events);
  if (!events.length) {
    return {
      total: 0,
      byType,
      minTime: null,
      maxTime: null,
      minTimeMs: null,
      maxTimeMs: null,
      spanMs: null,
      meanGapMs: null,
      minGapMs: null,
      maxGapMs: null,
    };
  }
  const times = events
    .map(e => {
      const stamped = withDualTime(e);
      return { t: stamped.time, ms: sortKeyEpochMs(stamped) };
    })
    .filter(x => Number.isFinite(x.ms) && x.ms !== Number.NEGATIVE_INFINITY)
    .sort((a, b) => a.ms - b.ms);
  if (!times.length) {
    return {
      total: events.length,
      byType,
      minTime: null,
      maxTime: null,
      minTimeMs: null,
      maxTimeMs: null,
      spanMs: null,
      meanGapMs: null,
      minGapMs: null,
      maxGapMs: null,
    };
  }
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push(times[i]!.ms - times[i - 1]!.ms);
  }
  const minTime = times[0]!.t;
  const maxTime = times[times.length - 1]!.t;
  const minTimeMs = times[0]!.ms;
  const maxTimeMs = times[times.length - 1]!.ms;
  const spanMs = maxTimeMs - minTimeMs;
  return {
    total: events.length,
    byType,
    minTime,
    maxTime,
    minTimeMs,
    maxTimeMs,
    spanMs,
    meanGapMs: gaps.length
      ? gaps.reduce((a, b) => a + b, 0) / gaps.length
      : null,
    minGapMs: gaps.length ? Math.min(...gaps) : null,
    maxGapMs: gaps.length ? Math.max(...gaps) : null,
  };
}

export function formatEventsCsv(
  events: LiveTrackerEvent[],
  columns?: string[] | null
): string {
  const cols = resolveColumns(columns);
  const keys = cols.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const esc = (s: string) => {
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.map(esc).join(',')];
  for (const e of events) {
    lines.push(
      keys
        .map(k => esc((COL_MAP[k] ?? (() => '—'))(e)))
        .join(',')
    );
  }
  return lines.join('\n');
}

const COL_MAP: Record<string, (e: LiveTrackerEvent) => string> = {
  time: e => e.time,
  timems: e => {
    const ms = withDualTime(e).timeMs;
    return ms != null ? String(ms) : '—';
  },
  event: e => e.eventType,
  eventtype: e => e.eventType,
  type: e => e.eventType,
  detail: e => e.detail,
  file: e => {
    if (!e.file) return '—';
    const parts = e.file.split('/');
    return parts[parts.length - 1] || e.file;
  },
  eventid: e => String(e.eventId),
  period: e => e.period ?? '—',
  markettype: e => e.marketType ?? '—',
  market: e => e.marketType ?? '—',
  selection: e => e.selection ?? '—',
  from: e => (e.from != null ? String(e.from) : '—'),
  to: e => (e.to != null ? String(e.to) : '—'),
};

function resolveColumns(raw?: string[] | null): string[] {
  if (!raw?.length) {
    return ['Time', 'Event', 'EventId', 'Period', 'Market', 'Detail'];
  }
  return raw.map(c => c.trim()).filter(Boolean);
}

export function formatEventsTable(
  events: LiveTrackerEvent[],
  columns?: string[] | null
): string {
  const cols = resolveColumns(columns);
  const keys = cols.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const getters = keys.map(k => COL_MAP[k] ?? (() => '—'));

  const rows = events.map(e => getters.map(g => g(e)));
  if (!rows.length) return '(no events)';

  const widths = cols.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );
  const pad = (cells: string[]) =>
    '| ' +
    cells.map((c, i) => (c ?? '').padEnd(widths[i] ?? 0)).join(' | ') +
    ' |';
  const sep =
    '| ' + widths.map(w => '-'.repeat(Math.max(w, 3))).join(' | ') + ' |';
  return [pad(cols), sep, ...rows.map(r => pad(r))].join('\n');
}

export function eventsToObjects(
  events: LiveTrackerEvent[],
  columns?: string[] | null
): Array<Record<string, string>> {
  const cols = resolveColumns(columns);
  const keys = cols.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return events.map(e => {
    const o: Record<string, string> = {};
    cols.forEach((col, i) => {
      const g = COL_MAP[keys[i]!] ?? (() => '—');
      o[col] = g(e);
    });
    return o;
  });
}

/** Parse a single JSON object into events when possible. Always dual-stamps time/timeMs. */
export function parseTrackerJsonValue(
  row: unknown,
  file?: string
): LiveTrackerEvent[] {
  if (row == null) return [];
  if (Array.isArray(row)) {
    // array of events
    if (row.length && typeof row[0] === 'object' && row[0] && 'eventType' in (row[0] as object)) {
      return (row as LiveTrackerEvent[]).map(e =>
        withDualTime({
          ...e,
          file: e.file ?? file,
        }),
      );
    }
    return [];
  }
  if (typeof row !== 'object') return [];
  const o = row as Record<string, unknown>;
  if (Array.isArray(o.events)) {
    return (o.events as LiveTrackerEvent[]).map(e =>
      withDualTime({
        ...e,
        file: e.file ?? file,
      }),
    );
  }
  if (typeof o.eventType === 'string' && typeof o.time === 'string') {
    return [
      withDualTime({
        ...(o as unknown as LiveTrackerEvent),
        file: file ?? (o.file as string | undefined),
      }),
    ];
  }
  if (typeof o.at === 'string' && (typeof o.eventId === 'number' || typeof o.eventId === 'string')) {
    const u = o as unknown as OddsWatchUpdate;
    return eventsFromWatchUpdate(u, { file });
  }
  return [];
}

/** Parse JSONL tracker log (one LiveTrackerLogRecord or LiveTrackerEvent per line). */
function parseTrackerJsonl(
  text: string,
  file?: string
): LiveTrackerEvent[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Whole-file JSON (array or object)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const fromDoc = parseTrackerJsonValue(parsed, file);
      if (fromDoc.length) return fromDoc;
      // JSONL disguised as multi-line: fall through to line mode if object has no events
    } catch {
      /* line mode */
    }
  }

  // Bun.JSONL line mode with skip-and-continue: bad lines are reported by the
  // shared helper instead of silently truncating the tail (raw Bun.JSONL.parse
  // stops at the first invalid line — see src/lib/jsonl.ts).
  const { values } = parseJsonlText(text);
  const out: LiveTrackerEvent[] = [];
  for (const row of values) {
    out.push(...parseTrackerJsonValue(row, file));
  }
  return out;
}

export async function loadTrackerEventsFromPaths(
  paths: string[]
): Promise<LiveTrackerEvent[]> {
  const all: LiveTrackerEvent[] = [];
  for (const p of paths) {
    const f = Bun.file(p);
    if (!(await f.exists())) continue;
    const text = await f.text();
    all.push(...parseTrackerJsonl(text, p));
  }
  return all;
}

/**
 * Diff two event lists: events only in `next` (MARKET_ADDED-style presence),
 * plus PRICE_CHANGE when same key has different detail/from/to.
 * Labels file as basename of paths.
 */
export function diffEventLists(
  prev: LiveTrackerEvent[],
  next: LiveTrackerEvent[],
  options: { oldFile?: string; newFile?: string; at?: string } = {}
): LiveTrackerEvent[] {
  const at = options.at ?? new Date().toISOString();
  const oldBase = options.oldFile?.split('/').pop() ?? 'old';
  const newBase = options.newFile?.split('/').pop() ?? 'new';
  const keyOf = (e: LiveTrackerEvent) =>
    `${e.eventType}\0${e.eventId}\0${e.period ?? ''}\0${e.marketType ?? ''}\0${e.selection ?? ''}\0${e.detail}`;
  const prevKeys = new Set(prev.map(keyOf));
  const nextKeys = new Set(next.map(keyOf));
  const out: LiveTrackerEvent[] = [];

  for (const e of next) {
    if (!prevKeys.has(keyOf(e))) {
      out.push({
        ...e,
        time: e.time || at,
        file: newBase,
        detail: e.detail.startsWith('[+]') ? e.detail : `[+] ${e.detail}`,
      });
    }
  }
  for (const e of prev) {
    if (!nextKeys.has(keyOf(e))) {
      out.push({
        ...e,
        time: e.time || at,
        file: oldBase,
        eventType:
          e.eventType === 'MARKET_ADDED'
            ? 'MARKET_REMOVED'
            : e.eventType === 'SELECTION_ADDED'
              ? 'SELECTION_REMOVED'
              : e.eventType,
        detail: e.detail.startsWith('[-]') ? e.detail : `[-] ${e.detail}`,
      });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}



/**
 * Dual-stamp log envelope + every nested event before disk write.
 * Ensures new JSONL lines always carry `at`/`atMs` and `time`/`timeMs`.
 */
export function stampTrackerLogRecord(record: LiveTrackerLogRecord): LiveTrackerLogRecord {
  const envelope = dualTime(record.at);
  const at = envelope?.time ?? record.at;
  const atMs = envelope?.timeMs ?? record.atMs ?? null;
  const events = (record.events ?? []).map(e =>
    withDualTime({
      ...e,
      // Prefer event time; fall back to envelope if missing
      time: e.time || at,
    }),
  );
  return {
    ...record,
    at,
    atMs,
    events,
  };
}

export async function appendTrackerLog(
  path: string,
  record: LiveTrackerLogRecord
): Promise<void> {
  const stamped = stampTrackerLogRecord(record);
  const dir = path.replace(/\/[^/]+$/, '');
  await Bun.$`mkdir -p ${dir}`.nothrow().quiet();
  const line = JSON.stringify(stamped) + '\n';
  const existing = Bun.file(path);
  if (await existing.exists()) {
    const prev = await existing.arrayBuffer();
    const enc = new TextEncoder();
    const next = new Uint8Array(prev.byteLength + enc.encode(line).byteLength);
    next.set(new Uint8Array(prev), 0);
    next.set(enc.encode(line), prev.byteLength);
    await Bun.write(path, next);
  } else {
    await Bun.write(path, line);
  }
}

/** Strip leading # from market/event ids. */
export function normalizeWireId(raw: string | number): string {
  return String(raw).trim().replace(/^#/, '');
}
