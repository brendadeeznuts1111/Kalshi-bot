import { sha3Hex } from "../evidence-chain.ts";
import {
  asCanonicalEventId,
  asCompetitorId,
  asKalshiEventTicker,
  type CanonicalEventId,
  type CompetitorId,
  type KalshiEventTicker,
  type SeriesTicker,
  unbrand,
} from "./brands.ts";

/** Legacy / fallback — ticker blob alone collides across singles↔doubles surname codes. */
export function mintKalshiEventId(eventTicker: KalshiEventTicker): CanonicalEventId {
  return asCanonicalEventId(sha3Hex(`kalshi|${unbrand(eventTicker)}`).slice(0, 32));
}

/**
 * Canonical start for Kalshi competitor event_id hashing: UTC truncated to the minute.
 * Merges ISO format drift (Z / .000Z / +00:00); does not merge different minutes (e.g. schedule reschedule).
 */
export function normalizeKalshiStartTs(startTs: string): string {
  const trimmed = startTs.trim();
  if (!trimmed) {
    throw new Error("normalizeKalshiStartTs requires a non-empty startTs");
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    throw new Error(`normalizeKalshiStartTs: invalid ISO startTs: ${trimmed}`);
  }
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day}T${h}:${mi}:00.000Z`;
}

/**
 * Canonical Kalshi tennis event id: sorted competitor UUIDs + start time + series.
 * Never key exposure on the ticker matchup blob alone.
 */
export function mintKalshiCompetitorEventId(parts: {
  series: SeriesTicker;
  competitorA: CompetitorId;
  competitorB: CompetitorId;
  startTs: string;
}): CanonicalEventId {
  const a = unbrand(parts.competitorA).trim();
  const b = unbrand(parts.competitorB).trim();
  if (!a || !b || a === b) {
    throw new Error("mintKalshiCompetitorEventId requires two distinct competitor ids");
  }
  const [c0, c1] = [a, b].sort((x, y) => x.localeCompare(y));
  const start = normalizeKalshiStartTs(parts.startTs);
  const series = unbrand(parts.series).trim();
  if (!series) {
    throw new Error("mintKalshiCompetitorEventId requires series and startTs");
  }
  return asCanonicalEventId(
    sha3Hex(`kalshi|comp|${series}|${c0}|${c1}|${start}`).slice(0, 32),
  );
}

export function tryMintKalshiEventIdFromMarkets(input: {
  eventTicker: KalshiEventTicker;
  series: SeriesTicker;
  startTs: string;
  competitorIds: Array<CompetitorId | undefined | null>;
}): { eventId: CanonicalEventId; keyedBy: "competitors" | "ticker" } {
  const unique = [
    ...new Set(
      input.competitorIds
        .map((c) => (c ? unbrand(c).trim() : ""))
        .filter((c): c is string => Boolean(c)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  if (unique.length === 2) {
    return {
      eventId: mintKalshiCompetitorEventId({
        series: input.series,
        competitorA: asCompetitorId(unique[0]!),
        competitorB: asCompetitorId(unique[1]!),
        startTs: input.startTs,
      }),
      keyedBy: "competitors",
    };
  }
  return { eventId: mintKalshiEventId(input.eventTicker), keyedBy: "ticker" };
}

/**
 * Stable Kalshi venue identity for UNIQUE(source_row_hash).
 * Ticker-only (not startTs) so occurrence reschedule rematerializes one row
 * instead of colliding a new competitor event_id against the same hash.
 */
export function kalshiSourceRowHash(eventTicker: KalshiEventTicker): string {
  return sha3Hex(`kalshi-event|${unbrand(eventTicker)}`);
}

export { kalshiMarketId } from "./brands.ts";
