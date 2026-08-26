/**
 * Live-product stream-list sports + leagues inventory (plive/ezlive shell).
 * Coverage-only — no odds. Domain plane / inventory plane — not seat partner.
 * Compare against {@link FANTASY_SPORT_MAPPINGS}.
 */
// @see https://bun.com/docs/api/fetch
import { FANTASY_ULTRA_DEFAULTS } from '../partner/fantasy-ultra/types.ts';
import {
  FANTASY_SPORT_MAPPINGS,
  fantasySportByStreamBucket,
  type FantasySportMapping,
} from '../partner/fantasy-ultra/widget-config.ts';

import type { FetchFn } from '../institutions/resilient-fetch.ts';
import type { CoefficientLine } from '../partner/fantasy-ultra/coefficients.ts';
import { PLIVE_STREAM_ENDPOINTS } from '../domain/live-product-endpoints.ts';
import { probePandoraEvent } from './pandora-listen.ts';
import { streamListHeaders } from './stream-list-fetch.ts';

export type StreamSportLeagueRow = {
  streamBucket: string;
  league: string;
  eventCount: number;
};

export type StreamSportInventoryRow = {
  streamBucket: string;
  /** Label from map or sample event.sport */
  label: string;
  eventCount: number;
  leagueCount: number;
  /** Distinct leagues with event counts (sorted by count desc) */
  leagues: StreamSportLeagueRow[];
  sampleSportLabel: string | null;
  mapped: boolean;
  primary: boolean;
  mapping: Pick<
    FantasySportMapping,
    "canonical" | "apiSportId" | "widgetSportId" | "label" | "primary"
  > | null;
};

export type StreamSportsInventory = {
  fetchedAt: number;
  url: string;
  sportBuckets: number;
  totalEvents: number;
  mappedBuckets: number;
  unmappedBuckets: string[];
  mapOnlyBuckets: string[];
  primaryLive: number;
  rows: StreamSportInventoryRow[];
};

type StreamBucketWire = {
  count?: number;
  events?: Record<string, StreamEventWire> | StreamEventWire[];
};

type StreamEventWire = {
  sport?: string;
  league?: string;
};

function eventList(bucket: StreamBucketWire | undefined): StreamEventWire[] {
  if (!bucket?.events) return [];
  if (Array.isArray(bucket.events)) return bucket.events;
  if (typeof bucket.events === "object") {
    return Object.values(bucket.events);
  }
  return [];
}

/**
 * Parse stream-list-v2 JSON into per-sport inventory + league breakdown.
 */
export function inventoryFromStreamList(
  wire: unknown,
  options: { url?: string } = {},
): StreamSportsInventory {
  const url = options.url ?? FANTASY_ULTRA_DEFAULTS.streamListUrl;
  const fetchedAt = Date.now();
  if (!wire || typeof wire !== "object") {
    return {
      fetchedAt,
      url,
      sportBuckets: 0,
      totalEvents: 0,
      mappedBuckets: 0,
      unmappedBuckets: [],
      mapOnlyBuckets: FANTASY_SPORT_MAPPINGS.map((m) => m.streamBucket),
      primaryLive: 0,
      rows: [],
    };
  }
  const sports =
    (wire as { sports?: Record<string, StreamBucketWire> }).sports ?? {};
  const liveBuckets = Object.keys(sports);
  const mappedSet = new Set(FANTASY_SPORT_MAPPINGS.map((m) => m.streamBucket));

  const rows: StreamSportInventoryRow[] = [];
  for (const streamBucket of liveBuckets.sort()) {
    const bucket = sports[streamBucket];
    const events = eventList(bucket);
    const eventCount =
      typeof bucket?.count === "number" && bucket.count > 0
        ? bucket.count
        : events.length;

    const leagueCounts = new Map<string, number>();
    let sampleSportLabel: string | null = null;
    for (const e of events) {
      if (!sampleSportLabel && e.sport) sampleSportLabel = String(e.sport);
      const league = String(e.league ?? "").trim() || "(unknown)";
      leagueCounts.set(league, (leagueCounts.get(league) ?? 0) + 1);
    }
    const leagues: StreamSportLeagueRow[] = [...leagueCounts.entries()]
      .map(([league, n]) => ({ streamBucket, league, eventCount: n }))
      .sort(
        (a, b) =>
          b.eventCount - a.eventCount || a.league.localeCompare(b.league),
      );

    const mapping = fantasySportByStreamBucket(streamBucket) ?? null;
    rows.push({
      streamBucket,
      label: mapping?.label ?? sampleSportLabel ?? streamBucket,
      eventCount,
      leagueCount: leagues.length,
      leagues,
      sampleSportLabel,
      mapped: mapping != null,
      primary: mapping?.primary ?? false,
      mapping: mapping
        ? {
            canonical: mapping.canonical,
            apiSportId: mapping.apiSportId,
            widgetSportId: mapping.widgetSportId,
            label: mapping.label,
            primary: mapping.primary,
          }
        : null,
    });
  }

  rows.sort(
    (a, b) =>
      b.eventCount - a.eventCount ||
      a.streamBucket.localeCompare(b.streamBucket),
  );

  const liveSet = new Set(liveBuckets);
  const unmappedBuckets = liveBuckets.filter((b) => !mappedSet.has(b));
  const mapOnlyBuckets = FANTASY_SPORT_MAPPINGS.map((m) => m.streamBucket).filter(
    (b) => !liveSet.has(b),
  );
  const totalEvents = rows.reduce((s, r) => s + r.eventCount, 0);
  const mappedBuckets = rows.filter((r) => r.mapped).length;
  const primaryLive = rows.filter((r) => r.primary && r.eventCount > 0).length;

  return {
    fetchedAt,
    url,
    sportBuckets: rows.length,
    totalEvents,
    mappedBuckets,
    unmappedBuckets,
    mapOnlyBuckets,
    primaryLive,
    rows,
  };
}

/** GET stream-list-v2 and build inventory (retry + disk cache fallback). */
export async function fetchStreamSportsInventory(
  options: { url?: string; fetchImpl?: typeof fetch; cacheOnly?: boolean } = {},
): Promise<StreamSportsInventory> {
  const { fetchPublicStreamListWire } = await import("./stream-list-fetch.ts");
  const { wire, url } = await fetchPublicStreamListWire({
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.cacheOnly !== undefined ? { cacheOnly: options.cacheOnly } : {}),
  });
  return inventoryFromStreamList(wire, { url });
}

/** Static map size for agents. */
export function staticSportMapSummary(): {
  total: number;
  primary: number;
  /** Ticket apiSportId set (mainapp isX + TT betGroups; not all sports). */
  withApiId: number;
  /** Pandora feedSportId set. */
  withFeedId: number;
  buckets: string[];
} {
  return {
    total: FANTASY_SPORT_MAPPINGS.length,
    primary: FANTASY_SPORT_MAPPINGS.filter((m) => m.primary).length,
    withApiId: FANTASY_SPORT_MAPPINGS.filter((m) => m.apiSportId != null).length,
    withFeedId: FANTASY_SPORT_MAPPINGS.filter((m) => m.feedSportId != null)
      .length,
    buckets: FANTASY_SPORT_MAPPINGS.map((m) => m.streamBucket),
  };
}


function competitors(ev: Record<string, unknown>): {
  home: string | null;
  away: string | null;
} {
  const c = (ev.competitiors ?? ev.competitors) as
    | { home?: unknown; away?: unknown }
    | undefined;
  const home =
    ev.home != null
      ? String(ev.home)
      : c?.home != null
        ? String(c.home)
        : ev.team1 != null
          ? String(ev.team1)
          : null;
  const away =
    ev.away != null
      ? String(ev.away)
      : c?.away != null
        ? String(c.away)
        : ev.team2 != null
          ? String(ev.team2)
          : null;
  return { home, away };
}

function samplePliveUrl(eventId: string | number, periodId?: string | null): string {
  const origin = FANTASY_ULTRA_DEFAULTS.streamOrigin;
  const base = `${origin}/live/?#!/event/${eventId}`;
  return periodId ? `${base}/${periodId}` : base;
}

/** One stream-list sample per sport bucket (inventory plane). */
export type SportBoardSample = {
  bucket: string;
  inventoryId: string;
  league: string | null;
  home: string | null;
  away: string | null;
  sport: string | null;
  pliveUrl: string;
  /** Pandora coefficients for this id (usually 0 — different id space). */
  pandoraLineCount: number;
  periods: string[];
};

/**
 * Sample live stream-list board across sports (optional short Pandora probe per id).
 * Inventory ids usually have 0 Pandora lines — documents id-space split multi-sport.
 */
export async function sampleStreamListBySport(
  options: {
    maxSports?: number;
    pandoraSeconds?: number;
    fetchImpl?: FetchFn;
    WebSocketImpl?: typeof WebSocket;
    streamListUrl?: string;
  } = {}
): Promise<SportBoardSample[]> {
  const maxSports = Math.min(Math.max(options.maxSports ?? 20, 1), 40);
  const pandoraSeconds = options.pandoraSeconds ?? 0;
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.streamListUrl ?? PLIVE_STREAM_ENDPOINTS.streamListUrl;
  const res = await fetchImpl(url, {
    headers: streamListHeaders(),
  });
  if (!res.ok) throw new Error(`stream-list HTTP ${res.status}`);
  const wire = (await res.json()) as {
    sports?: Record<
      string,
      { events?: Record<string, Record<string, unknown>> }
    >;
  };

  const samples: SportBoardSample[] = [];
  for (const [bucket, block] of Object.entries(wire.sports ?? {})) {
    const events = Object.entries(block.events ?? {});
    if (!events.length) continue;
    const [id, ev] = events[0]!;
    const { home, away } = competitors(ev);
    const sample: SportBoardSample = {
      bucket,
      inventoryId: id,
      league: ev.league != null ? String(ev.league) : null,
      home,
      away,
      sport: ev.sport != null ? String(ev.sport) : null,
      pliveUrl: samplePliveUrl(id, 'm'),
      pandoraLineCount: 0,
      periods: [],
    };
    if (pandoraSeconds > 0) {
      try {
        const p = await probePandoraEvent(Number(id), {
          seconds: pandoraSeconds,
          WebSocketImpl: options.WebSocketImpl,
        });
        sample.pandoraLineCount = p.lines.length;
        sample.periods = [
          ...new Set(p.lines.map((l: CoefficientLine) => l.period || 'm')),
        ].sort();
      } catch {
        /* ignore */
      }
    }
    samples.push(sample);
    if (samples.length >= maxSports) break;
  }
  return samples;
}

export function formatSportBoardSamples(samples: SportBoardSample[]): string {
  const lines: string[] = [];
  lines.push(`stream-list multi-sport sample (${samples.length} buckets)`);
  lines.push('note: inventory stream_id usually has 0 Pandora coefficient lines');
  lines.push('');
  for (const s of samples) {
    lines.push(
      `${s.bucket.padEnd(16)} id=${s.inventoryId} pandora_lines=${s.pandoraLineCount}` +
        (s.periods.length ? ` periods=[${s.periods.join(',')}]` : '')
    );
    lines.push(
      `  ${s.league ?? '—'} · ${s.home ?? '?'} vs ${s.away ?? '?'}`
    );
    lines.push(`  ${s.pliveUrl}`);
  }
  return lines.join('\n');
}
