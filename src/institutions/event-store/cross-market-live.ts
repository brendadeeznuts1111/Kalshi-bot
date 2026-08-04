/** Live cross-market enrichment. Unmatched events remain null; values are never fabricated. */
import {
  fetchAllPolymarketTennisEvents,
  type FetchAllTennisEventsOptions,
  type PolymarketEvent,
} from "../../regulatory/integrations/polymarket.ts";
import {
  findPolymarketMatch,
  normalizeTennisName,
  polymarketSlugCodes,
  polymarketSlugDate,
  tennisSurname,
} from "./matcher-v2.ts";
import type { CrossMarketOdds } from "./types.ts";

const MONTH_TO_NUM: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};
const DEFAULT_CACHE_TTL_MS = 60_000;

type LiveOddsCache = {
  expiresAt: number;
  baseUrl: string | undefined;
  fetchImpl: FetchAllTennisEventsOptions["fetchImpl"];
  events: Promise<PolymarketEvent[]>;
};

let liveOddsCache: LiveOddsCache | null = null;

export type LiveOddsTarget = {
  ticker: string;
  playerA: string;
  playerB: string;
  tournament?: string;
};

export type FetchLiveCrossMarketOddsOptions = FetchAllTennisEventsOptions & {
  cacheTtlMs?: number;
  nowMs?: number;
};

function emptyOdds(): CrossMarketOdds {
  return {
    polymarketProb: null,
    polymarketVolume24h: null,
    polymarketVolumeLifetime: null,
    polymarketLiquidity: null,
    polymarketOpenInterest: null,
    polymarketEventId: null,
    polymarketMatchMethod: null,
    pinnacleProb: null,
  };
}

export function firstInitial(full: string): string {
  return normalizeTennisName(full).split(" ").filter(Boolean)[0]?.[0] ?? "";
}

export function lastName(full: string): string {
  return tennisSurname(full);
}

/** @deprecated V2 matches surname codes and full-name outcomes directly. */
export function initialLastNamePrefix(full: string): string {
  const initial = firstInitial(full);
  const surname = lastName(full);
  return initial && surname ? `${initial}${surname.slice(0, 4)}` : "";
}

export function slugCodes(slug: string): [string, string] | null {
  return polymarketSlugCodes(slug);
}

export function parseSlugDate(slug: string): string | null {
  return polymarketSlugDate(slug);
}

/**
 * Parse the Kalshi `YYMMMDD` token after the series prefix.
 * `KXITFMATCH-26AUG04…` is August 4, 2026.
 */
export function parseKalshiDate(ticker: string): string | null {
  const match = ticker.match(
    /^[A-Z]+-(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})/i,
  );
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = MONTH_TO_NUM[match[2]!.toUpperCase()];
  const day = Number(match[3]);
  if (!month || !Number.isInteger(day)) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/** @deprecated Retained for callers while V2 no longer uses initial-prefixed codes. */
export function initialPrefixMatches(prefix: string, code: string): boolean {
  if (!prefix || !code || prefix.length < 4 || code.length < 4) return false;
  return code.startsWith(prefix) || prefix === code;
}

async function fetchCachedEvents(
  options: FetchLiveCrossMarketOddsOptions,
): Promise<PolymarketEvent[]> {
  const nowMs = options.nowMs ?? Date.now();
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  if (
    liveOddsCache &&
    liveOddsCache.expiresAt > nowMs &&
    liveOddsCache.baseUrl === options.baseUrl &&
    liveOddsCache.fetchImpl === options.fetchImpl
  ) {
    return liveOddsCache.events;
  }

  const { cacheTtlMs: _, nowMs: __, ...fetchOptions } = options;
  const events = fetchAllPolymarketTennisEvents(fetchOptions).catch((error) => {
    if (liveOddsCache?.events === events) liveOddsCache = null;
    throw error;
  });
  liveOddsCache = {
    expiresAt: nowMs + cacheTtlMs,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
    events,
  };
  return events;
}

export function resetLiveOddsCacheForTests(): void {
  liveOddsCache = null;
}

/**
 * Fetch the complete active tennis inventory once, then reconcile every Kalshi target.
 * The inventory promise is shared for 60 seconds across logger cycles.
 */
export async function fetchLiveCrossMarketOdds(
  targets: readonly LiveOddsTarget[],
  options: FetchLiveCrossMarketOddsOptions = {},
): Promise<Map<string, CrossMarketOdds>> {
  const result = new Map<string, CrossMarketOdds>();
  for (const target of targets) result.set(target.ticker, emptyOdds());

  const events = await fetchCachedEvents(options);
  for (const target of targets) {
    const match = findPolymarketMatch(
      {
        ...target,
        date: parseKalshiDate(target.ticker),
      },
      events,
    );
    if (!match) continue;

    const probability = match.market.outcomePrices[match.playerAOutcomeIndex];
    if (probability === undefined || !Number.isFinite(probability)) continue;
    const liquidity =
      match.market.liquidityClob > 0
        ? match.market.liquidityClob
        : match.market.liquidity;
    result.set(target.ticker, {
      polymarketProb: probability,
      polymarketVolume24h: match.market.volume24hr,
      polymarketVolumeLifetime: match.market.volume,
      polymarketLiquidity: liquidity,
      polymarketOpenInterest:
        match.market.openInterest ?? match.event.openInterest,
      polymarketEventId: match.event.id,
      polymarketMatchMethod: match.method,
      pinnacleProb: null,
    });
  }

  return result;
}
