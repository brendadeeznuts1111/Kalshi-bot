/**
 * Live market event tracker — normalize Pandora offer transitions into a
 * stable event log (MARKET_ADDED / MARKET_REMOVED / PRICE_CHANGE / …).
 *
 * Used by root `live-tracker.ts` CLI: diff · watch · analyze.
 */
import type {
  EventDataStateTransition,
  OfferTransition,
} from '../partner/fantasy-ultra/coefficients.ts';
import type { OddsWatchUpdate } from './event-lookup.ts';
import { CACHE_DIR, joinPath } from '../research/paths.ts';

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

export type LiveTrackerEventType = (typeof LIVE_TRACKER_EVENT_TYPES)[number];

export type LiveTrackerEvent = {
  time: string;
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
  file?: string;
  /** Raw kind from OfferTransition / eventData. */
  rawKind?: string;
};

export type LiveTrackerLogRecord = {
  at: string;
  eventId: number;
  lineCount: number;
  offeredMarketCount: number;
  events: LiveTrackerEvent[];
};

export const LIVE_TRACKER_LOG_DIR = joinPath(CACHE_DIR, 'live-tracker');

export function defaultLiveTrackerLogPath(eventId: number | string): string {
  return joinPath(LIVE_TRACKER_LOG_DIR, `event-${eventId}.jsonl`);
}

export function offerTransitionToEvent(
  t: OfferTransition,
  ctx: { at: string; eventId: number; file?: string }
): LiveTrackerEvent {
  const base = {
    time: ctx.at,
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

export function eventDataTransitionToEvent(
  t: EventDataStateTransition,
  ctx: { at: string; eventId: number; file?: string }
): LiveTrackerEvent {
  const base = {
    time: ctx.at,
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
  options: { includeTicks?: boolean; file?: string } = {}
): LiveTrackerEvent[] {
  const ctx = { at: u.at, eventId: u.eventId, file: options.file };
  const out: LiveTrackerEvent[] = [];
  for (const t of u.transitions) {
    out.push(offerTransitionToEvent(t, ctx));
  }
  for (const t of u.eventTransitions) {
    out.push(eventDataTransitionToEvent(t, ctx));
  }
  if (options.includeTicks && out.length === 0) {
    out.push({
      time: u.at,
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

export type DiffQuery = {
  eventType?: LiveTrackerEventType | null;
  eventId?: string | number | null;
  marketType?: string | null;
  period?: string | null;
  sortBy?: 'time' | 'event' | 'detail' | 'file';
  desc?: boolean;
  limit?: number;
  columns?: string[];
};

export function filterAndSortEvents(
  events: LiveTrackerEvent[],
  q: DiffQuery
): LiveTrackerEvent[] {
  let rows = events;
  if (q.eventType) {
    rows = rows.filter(e => e.eventType === q.eventType);
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

  const sortBy = q.sortBy ?? 'time';
  const dir = q.desc ? -1 : 1;
  rows = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'time') cmp = a.time.localeCompare(b.time);
    else if (sortBy === 'event') cmp = a.eventType.localeCompare(b.eventType);
    else if (sortBy === 'detail') cmp = a.detail.localeCompare(b.detail);
    else if (sortBy === 'file')
      cmp = (a.file ?? '').localeCompare(b.file ?? '');
    return cmp * dir;
  });

  if (q.limit != null && q.limit > 0) {
    rows = rows.slice(0, q.limit);
  }
  return rows;
}

export function summarizeEventTypes(
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

const COL_MAP: Record<string, (e: LiveTrackerEvent) => string> = {
  time: e => e.time,
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

export function resolveColumns(raw?: string[] | null): string[] {
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

/** Parse JSONL tracker log (one LiveTrackerLogRecord or LiveTrackerEvent per line). */
export function parseTrackerJsonl(
  text: string,
  file?: string
): LiveTrackerEvent[] {
  const out: LiveTrackerEvent[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t) as Record<string, unknown>;
      if (Array.isArray(row.events)) {
        for (const e of row.events as LiveTrackerEvent[]) {
          out.push({ ...e, file: e.file ?? file });
        }
      } else if (typeof row.eventType === 'string' && row.time) {
        out.push({ ...(row as unknown as LiveTrackerEvent), file: file ?? (row.file as string | undefined) });
      } else if (typeof row.at === 'string' && typeof row.eventId === 'number') {
        // OddsWatchUpdate shape
        const u = row as unknown as OddsWatchUpdate;
        out.push(...eventsFromWatchUpdate(u, { file }));
      }
    } catch {
      /* skip bad lines */
    }
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

export async function appendTrackerLog(
  path: string,
  record: LiveTrackerLogRecord
): Promise<void> {
  const dir = path.replace(/\/[^/]+$/, '');
  await Bun.$`mkdir -p ${dir}`.quiet();
  const line = JSON.stringify(record) + '\n';
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
