/** Live cross-market enrichment. Unmatched events remain null; values are never fabricated. */
import {
  fetchAllPolymarketEvents,
  type FetchAllEventsOptions,
  type PolymarketEvent,
} from "../../regulatory/integrations/polymarket.ts";
import {
  SOURCE,
  SPORT,
  unbrand as unbrandRegistry,
  type SportKey,
} from "../market-registry/brands.ts";
import {
  ADAPTERS,
  polymarketTagsForSport,
  registrationFor,
  sourceSelectorCacheKey,
} from "../market-registry/registry.ts";
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
const DEFAULT_CIRCUIT_COOLDOWN_MS = 60_000;
const POLYMARKET_CACHE_POLICY = (() => {
  const policy = ADAPTERS.find((adapter) => adapter.source === SOURCE.polymarket)?.cachePolicy;
  if (!policy) throw new Error("Polymarket cache policy missing from registry");
  return policy;
})();

type LiveOddsCache = {
  baseUrl: string | undefined;
  fetchImpl: FetchAllEventsOptions["fetchImpl"];
  pageSize: number | undefined;
  hasValue: boolean;
  events: PolymarketEvent[];
  freshUntilMs: number;
  staleUntilMs: number;
  refresh?: Promise<PolymarketEvent[]>;
  consecutiveFailures: number;
  circuitOpenUntilMs: number;
  lastSuccessAtMs?: number;
};

const liveOddsCaches = new Map<string, LiveOddsCache>();

export type LiveOddsTarget = {
  ticker: string;
  playerA: string;
  playerB: string;
  tournament?: string;
  sport?: SportKey;
};

export type FetchLiveCrossMarketOddsOptions = Omit<
  FetchAllEventsOptions,
  "tagId" | "tagSlug"
> & {
  cacheTtlMs?: number;
  staleTtlMs?: number;
  circuitCooldownMs?: number;
  nowMs?: number;
};

export type LiveOddsCacheHealth = {
  state: "empty" | "healthy" | "stale" | "degraded" | "circuit_open";
  consecutiveFailures: number;
  lastSuccessAtMs?: number;
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

/** Parse the Kalshi `YYMMMDD` token after the series prefix. */
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

function cacheForSport(sport: SportKey): {
  key: string;
  tag: ReturnType<typeof polymarketTagsForSport>[number];
} {
  const registration = registrationFor(SOURCE.polymarket, sport);
  if (
    registration?.state !== "enabled" ||
    !registration.operationalCapabilities.includes("inventory")
  ) {
    throw new Error(`Polymarket inventory is not operational for ${unbrandRegistry(sport)}`);
  }
  const tag = polymarketTagsForSport(sport)[0];
  if (!tag) throw new Error(`No Polymarket tag registered for ${unbrandRegistry(sport)}`);
  return { key: sourceSelectorCacheKey(SOURCE.polymarket, tag), tag };
}

function startRefresh(
  cache: LiveOddsCache,
  tag: ReturnType<typeof polymarketTagsForSport>[number],
  options: FetchLiveCrossMarketOddsOptions,
  nowMs: number,
): Promise<PolymarketEvent[]> {
  if (cache.refresh) return cache.refresh;
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? POLYMARKET_CACHE_POLICY.freshForMs);
  const staleTtlMs = Math.max(
    cacheTtlMs,
    options.staleTtlMs ?? POLYMARKET_CACHE_POLICY.staleForMs,
  );
  const { cacheTtlMs: _, staleTtlMs: __, circuitCooldownMs: ___, nowMs: ____, ...fetchOptions } =
    options;
  const refresh = fetchAllPolymarketEvents({
    ...fetchOptions,
    tagId: tag.tagId,
    tagSlug: tag.tagSlug,
  })
    .then((events) => {
      cache.events = events;
      cache.hasValue = true;
      cache.freshUntilMs = nowMs + cacheTtlMs;
      cache.staleUntilMs = nowMs + staleTtlMs;
      cache.consecutiveFailures = 0;
      cache.circuitOpenUntilMs = 0;
      cache.lastSuccessAtMs = nowMs;
      return events;
    })
    .catch((error) => {
      cache.consecutiveFailures++;
      if (cache.consecutiveFailures >= POLYMARKET_CACHE_POLICY.failureThreshold) {
        const failureAtMs = options.nowMs ?? Date.now();
        cache.circuitOpenUntilMs =
          failureAtMs + Math.max(0, options.circuitCooldownMs ?? DEFAULT_CIRCUIT_COOLDOWN_MS);
      }
      throw error;
    })
    .finally(() => {
      cache.refresh = undefined;
    });
  cache.refresh = refresh;
  return refresh;
}

async function fetchCachedEvents(
  sport: SportKey,
  options: FetchLiveCrossMarketOddsOptions,
): Promise<PolymarketEvent[]> {
  const nowMs = options.nowMs ?? Date.now();
  const { key, tag } = cacheForSport(sport);
  let cache = liveOddsCaches.get(key);
  if (
    !cache ||
    cache.baseUrl !== options.baseUrl ||
    cache.fetchImpl !== options.fetchImpl ||
    cache.pageSize !== options.pageSize
  ) {
    cache = {
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      pageSize: options.pageSize,
      hasValue: false,
      events: [],
      freshUntilMs: 0,
      staleUntilMs: 0,
      consecutiveFailures: 0,
      circuitOpenUntilMs: 0,
    };
    liveOddsCaches.set(key, cache);
  }
  if (cache.hasValue && nowMs < cache.freshUntilMs) return cache.events;
  if (nowMs < cache.circuitOpenUntilMs) {
    if (cache.hasValue) return cache.events;
    throw new Error(`Polymarket circuit open for ${unbrandRegistry(sport)} with no cached snapshot`);
  }
  if (cache.hasValue && nowMs < cache.staleUntilMs) {
    void startRefresh(cache, tag, options, nowMs).catch(() => undefined);
    return cache.events;
  }
  try {
    return await startRefresh(cache, tag, options, nowMs);
  } catch (error) {
    if (cache.hasValue) return cache.events;
    throw error;
  }
}

export function resetLiveOddsCacheForTests(): void {
  liveOddsCaches.clear();
}

export function liveOddsCacheHealth(
  sport: SportKey,
  nowMs = Date.now(),
): LiveOddsCacheHealth {
  const { key } = cacheForSport(sport);
  const cache = liveOddsCaches.get(key);
  if (!cache) {
    return { state: "empty", consecutiveFailures: 0 };
  }
  if (nowMs < cache.circuitOpenUntilMs) {
    return {
      state: "circuit_open",
      consecutiveFailures: cache.consecutiveFailures,
      ...(cache.lastSuccessAtMs !== undefined ? { lastSuccessAtMs: cache.lastSuccessAtMs } : {}),
    };
  }
  if (!cache.hasValue) {
    return { state: "empty", consecutiveFailures: cache?.consecutiveFailures ?? 0 };
  }
  const state =
    nowMs < cache.circuitOpenUntilMs
      ? "circuit_open"
      : cache.consecutiveFailures > 0
        ? "degraded"
        : nowMs >= cache.freshUntilMs
          ? "stale"
          : "healthy";
  return {
    state,
    consecutiveFailures: cache.consecutiveFailures,
    ...(cache.lastSuccessAtMs !== undefined ? { lastSuccessAtMs: cache.lastSuccessAtMs } : {}),
  };
}

/** Fetch each sport's complete tagged inventory once, then reconcile its Kalshi targets. */
export async function fetchLiveCrossMarketOdds(
  targets: readonly LiveOddsTarget[],
  options: FetchLiveCrossMarketOddsOptions = {},
): Promise<Map<string, CrossMarketOdds>> {
  const result = new Map<string, CrossMarketOdds>();
  const targetsBySport = new Map<SportKey, LiveOddsTarget[]>();
  for (const target of targets) {
    result.set(target.ticker, emptyOdds());
    const sport = target.sport ?? SPORT.tennis;
    const group = targetsBySport.get(sport);
    if (group) group.push(target);
    else targetsBySport.set(sport, [target]);
  }

  const settlements = await Promise.allSettled(
    [...targetsBySport].map(async ([sport, sportTargets]) => {
      const events = await fetchCachedEvents(sport, options);
      for (const target of sportTargets) {
        const match = findPolymarketMatch(
          { ...target, date: parseKalshiDate(target.ticker) },
          events,
        );
        if (!match) continue;
        const probability = match.market.outcomePrices[match.playerAOutcomeIndex];
        if (probability === undefined || !Number.isFinite(probability)) continue;
        const liquidity =
          (match.market.liquidityClob ?? 0) > 0
            ? match.market.liquidityClob
            : match.market.liquidity;
        result.set(target.ticker, {
          polymarketProb: probability,
          polymarketVolume24h: match.market.volume24hr,
          polymarketVolumeLifetime: match.market.volume,
          polymarketLiquidity: liquidity,
          polymarketOpenInterest: match.market.openInterest ?? match.event.openInterest ?? null,
          polymarketEventId: match.event.id,
          polymarketMatchMethod: match.method,
          pinnacleProb: null,
        });
      }
    }),
  );
  if (settlements.length > 0 && settlements.every((settlement) => settlement.status === "rejected")) {
    throw new AggregateError(
      settlements.map((settlement) =>
        settlement.status === "rejected" ? settlement.reason : undefined,
      ),
      "Every Polymarket sport scope failed",
    );
  }
  return result;
}
