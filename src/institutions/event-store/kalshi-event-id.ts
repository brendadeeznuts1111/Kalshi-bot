import { sha3Hex } from "../evidence-chain.ts";
import { asCanonicalEventId, type CanonicalEventId } from "./types.ts";

/** Legacy / fallback — ticker blob alone collides across singles↔doubles surname codes. */
export function mintKalshiEventId(eventTicker: string): CanonicalEventId {
  return asCanonicalEventId(sha3Hex(`kalshi|${eventTicker.trim()}`).slice(0, 32));
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
  series: string;
  competitorA: string;
  competitorB: string;
  startTs: string;
}): CanonicalEventId {
  const a = parts.competitorA.trim();
  const b = parts.competitorB.trim();
  if (!a || !b || a === b) {
    throw new Error("mintKalshiCompetitorEventId requires two distinct competitor ids");
  }
  const [c0, c1] = [a, b].sort((x, y) => x.localeCompare(y));
  const start = normalizeKalshiStartTs(parts.startTs);
  const series = parts.series.trim();
  if (!series) {
    throw new Error("mintKalshiCompetitorEventId requires series and startTs");
  }
  return asCanonicalEventId(
    sha3Hex(`kalshi|comp|${series}|${c0}|${c1}|${start}`).slice(0, 32),
  );
}

export function tryMintKalshiEventIdFromMarkets(input: {
  eventTicker: string;
  series: string;
  startTs: string;
  competitorIds: Array<string | undefined | null>;
}): { eventId: CanonicalEventId; keyedBy: "competitors" | "ticker" } {
  const unique = [
    ...new Set(
      input.competitorIds
        .map((c) => c?.trim())
        .filter((c): c is string => Boolean(c)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  if (unique.length === 2) {
    return {
      eventId: mintKalshiCompetitorEventId({
        series: input.series,
        competitorA: unique[0]!,
        competitorB: unique[1]!,
        startTs: input.startTs,
      }),
      keyedBy: "competitors",
    };
  }
  return { eventId: mintKalshiEventId(input.eventTicker), keyedBy: "ticker" };
}

export function kalshiMarketId(ticker: string): string {
  return `kalshi:${ticker}`;
}

export function kalshiSourceRowHash(eventTicker: string): string {
  return sha3Hex(`kalshi-event|${eventTicker}`);
}
