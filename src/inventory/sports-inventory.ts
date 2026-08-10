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
    url: options.url,
    fetchImpl: options.fetchImpl,
    cacheOnly: options.cacheOnly,
  });
  return inventoryFromStreamList(wire, { url });
}

/** Static map size for agents. */
export function staticSportMapSummary(): {
  total: number;
  primary: number;
  withApiId: number;
  buckets: string[];
} {
  return {
    total: FANTASY_SPORT_MAPPINGS.length,
    primary: FANTASY_SPORT_MAPPINGS.filter((m) => m.primary).length,
    withApiId: FANTASY_SPORT_MAPPINGS.filter((m) => m.apiSportId != null).length,
    buckets: FANTASY_SPORT_MAPPINGS.map((m) => m.streamBucket),
  };
}
