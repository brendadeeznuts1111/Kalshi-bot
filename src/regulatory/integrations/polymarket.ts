/**
 * Polymarket Gamma API client — public market data ingestion.
 *
 * No auth required for read-only endpoints.
 * @see https://docs.polymarket.com/
 */

import { OFFICIAL_URLS } from "../../institutions/official-urls.ts";
import type { SourceTagId } from "../../institutions/market-registry/brands.ts";
import { fetchWithRetry, type RetryOptions } from "../../institutions/resilient-fetch.ts";

export type PolymarketFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

// ── Wire types (sub-set of Gamma API response we care about) ──

export type PolymarketEvent = {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  description?: string;
  volume: number | null;
  volume24hr: number | null;
  openInterest?: number | null;
  liquidity: number | null;
  liquidityClob: number | null;
  active: boolean;
  closed: boolean;
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  updatedAt?: string;
  markets: PolymarketMarket[];
};

export type PolymarketMarket = {
  id: string;
  slug: string;
  question: string;
  description?: string;
  conditionId: string;
  resolutionSource?: string;
  outcomes: string[];       // parsed from JSON string
  outcomePrices: number[];  // parsed from JSON string
  volume: number | null;
  volume24hr: number | null;
  volume1wk: number | null;
  volume1mo: number | null;
  liquidity: number | null;
  liquidityClob: number | null;
  openInterest?: number | null;
  lastTradePrice: number | null;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  sportsMarketType?: string;
  active: boolean;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
  endDate?: string;
  event?: PolymarketEvent;
  events?: PolymarketEvent[];
};

export type PolymarketTick = {
  slug: string;
  yesPrice: number;
  noPrice: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  volume24hr: number;
  volumeTotal: number;
  liquidity: number;
  timestamp: number; // unix epoch seconds
};

export type PolymarketLineMove = {
  slug: string;
  direction: "up" | "down" | "flat";
  oldPrice: number;
  newPrice: number;
  deltaBp: number;          // basis points (1 bp = 0.01%)
  deltaAbs: number;         // absolute price delta
  volumeAtMove: number;
  detectedAt: number;       // unix epoch seconds
  windowSeconds: number;    // detection window
};

// ── Client options ──

export type PolymarketClientOptions = {
  baseUrl?: string;
  fetchImpl?: PolymarketFetchImpl;
} & Omit<RetryOptions, "fetchImpl">;

function resolveBaseUrl(explicit?: string): string {
  return (
    explicit?.replace(/\/$/, "") ??
    OFFICIAL_URLS.polymarket.gammaApiBase
  );
}

function resolveFetch(options: PolymarketClientOptions): PolymarketFetchImpl {
  return options.fetchImpl ?? fetch;
}

// ── Fetch helpers ──

async function getJson<T>(
  fetchImpl: PolymarketFetchImpl,
  url: string,
  retryOptions?: Omit<RetryOptions, "fetchImpl">,
): Promise<T> {
  const res = await fetchWithRetry(
    url,
    { headers: { Accept: "application/json" } },
    { ...retryOptions, fetchImpl },
  );
  if (!res.ok) {
    throw new Error(`Polymarket API ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Parse JSON array fields that Gamma may return serialized. */
function parseJsonArray(raw: unknown, field: string): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      throw new Error(`Polymarket ${field}: malformed JSON array`);
    }
  }
  throw new Error(`Polymarket ${field}: array required`);
}

function toNumber(raw: unknown, field: string): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Polymarket ${field}: expected a finite number`);
}

function toOptionalNumber(raw: unknown, field: string): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  return toNumber(raw, field);
}

function requiredString(raw: unknown, field: string): string {
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(`Polymarket ${field}: string required`);
  }
  const value = String(raw).trim();
  if (!value) throw new Error(`Polymarket ${field}: string required`);
  return value;
}

function toBoolean(raw: unknown, field: string): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`Polymarket ${field}: expected a boolean`);
}

// ── Public fetch functions ──

export type FetchMarketsOptions = {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
};

/** Fetch a page of markets from Gamma API. */
export async function fetchPolymarketMarkets(
  options: FetchMarketsOptions & PolymarketClientOptions = {},
): Promise<PolymarketMarket[]> {
  const fetchImpl = resolveFetch(options);
  const base = resolveBaseUrl(options.baseUrl);
  const limit = options.limit ?? 50;
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.active !== undefined) params.set("active", String(options.active));
  if (options.closed !== undefined) params.set("closed", String(options.closed));

  const { fetchImpl: _, baseUrl: __, ...retryOptions } = options;
  const url = `${base}/markets?${params.toString()}`;
  const raw = await getJson<Record<string, unknown>[]>(fetchImpl, url, retryOptions);

  return raw.map(normalizeMarketWire);
}

export type FetchAllTennisEventsOptions = PolymarketClientOptions & {
  /** Keyset pages support up to 500 events. */
  pageSize?: number;
  tagId?: SourceTagId;
  tagSlug?: string;
};

export type FetchAllEventsOptions = FetchAllTennisEventsOptions;

/**
 * Fetch every active event for one tag using Gamma keyset pagination.
 * The opaque `next_cursor` is passed back as `after_cursor`; offsets are never used.
 */
export async function fetchAllPolymarketEvents(
  options: FetchAllEventsOptions,
): Promise<PolymarketEvent[]> {
  const fetchImpl = resolveFetch(options);
  const base = resolveBaseUrl(options.baseUrl);
  const rawPageSize = options.pageSize ?? 500;
  if (!Number.isFinite(rawPageSize)) throw new Error("Polymarket pageSize must be finite");
  const pageSize = Math.max(1, Math.min(500, Math.floor(rawPageSize)));
  if (!options.tagId && !options.tagSlug) {
    throw new Error("Polymarket event scope requires tagId or tagSlug");
  }
  const {
    fetchImpl: _,
    baseUrl: __,
    pageSize: ___,
    tagId: ____,
    tagSlug: _____,
    ...retryOptions
  } = options;
  const events: PolymarketEvent[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let afterCursor: string | undefined;

  for (let page = 0; page < 1_000; page++) {
    const params = new URLSearchParams({
      active: "true",
      closed: "false",
      limit: String(pageSize),
    });
    if (options.tagId) params.set("tag_id", options.tagId);
    else if (options.tagSlug) params.set("tag_slug", options.tagSlug);
    if (afterCursor) params.set("after_cursor", afterCursor);
    const raw = await getJson<Record<string, unknown>>(
      fetchImpl,
      `${base}/events/keyset?${params.toString()}`,
      retryOptions,
    );
    const rows = Array.isArray(raw.events) ? (raw.events as Record<string, unknown>[]) : null;
    if (!rows) throw new Error("Polymarket keyset page: events array required");

    for (const row of rows) {
      const event = normalizeEventWire(row);
      if (seenIds.has(event.id)) {
        throw new Error(`Polymarket keyset pagination repeated event ${event.id}`);
      }
      seenIds.add(event.id);
      events.push(event);
    }
    const nextCursor =
      typeof raw.next_cursor === "string" && raw.next_cursor ? raw.next_cursor : undefined;
    if (raw.next_cursor !== undefined && raw.next_cursor !== null && !nextCursor) {
      throw new Error("Polymarket keyset page: next_cursor must be a non-empty string or null");
    }
    if (!nextCursor) return events;
    if (seenCursors.has(nextCursor)) {
      throw new Error(`Polymarket keyset pagination repeated cursor ${nextCursor}`);
    }
    seenCursors.add(nextCursor);
    afterCursor = nextCursor;
  }

  throw new Error("Polymarket pagination exceeded 1000 pages");
}

/** Compatibility wrapper for existing tennis consumers. */
export async function fetchAllPolymarketTennisEvents(
  options: FetchAllTennisEventsOptions = {},
): Promise<PolymarketEvent[]> {
  return fetchAllPolymarketEvents({ ...options, tagSlug: options.tagSlug ?? "tennis" });
}

/** Fetch a single market by its numeric ID. */
export async function fetchPolymarketMarket(
  marketId: string,
  options: PolymarketClientOptions = {},
): Promise<PolymarketMarket> {
  const fetchImpl = resolveFetch(options);
  const base = resolveBaseUrl(options.baseUrl);
  const { fetchImpl: _, baseUrl: __, ...retryOptions } = options;
  const url = `${base}/markets/${encodeURIComponent(marketId)}`;
  const raw = await getJson<Record<string, unknown>>(fetchImpl, url, retryOptions);
  return normalizeMarketWire(raw);
}

/** Build a tick snapshot from a market object. */
export function marketToTick(market: PolymarketMarket, now = Date.now()): PolymarketTick {
  const prices = market.outcomePrices;
  const yesIndex = market.outcomes.findIndex((outcome) => outcome.trim().toLowerCase() === "yes");
  const noIndex = market.outcomes.findIndex((outcome) => outcome.trim().toLowerCase() === "no");
  if (yesIndex < 0 || noIndex < 0) {
    throw new Error(`Polymarket marketToTick requires literal Yes/No outcomes: ${market.slug}`);
  }
  const yesPrice = prices[yesIndex] ?? market.lastTradePrice ?? 0;
  const noPrice = prices[noIndex] ?? 1 - yesPrice;
  const bestBid =
    yesIndex === 0 ? (market.bestBid ?? yesPrice) : 1 - (market.bestAsk ?? noPrice);
  const bestAsk =
    yesIndex === 0 ? (market.bestAsk ?? yesPrice) : 1 - (market.bestBid ?? noPrice);
  return {
    slug: market.slug,
    yesPrice: Number(yesPrice.toFixed(4)),
    noPrice: Number(noPrice.toFixed(4)),
    bestBid: Number(bestBid.toFixed(4)),
    bestAsk: Number(bestAsk.toFixed(4)),
    spread: Number((market.spread ?? Math.abs(bestAsk - bestBid)).toFixed(4)),
    volume24hr: market.volume24hr ?? 0,
    volumeTotal: market.volume ?? 0,
    liquidity: market.liquidityClob ?? market.liquidity ?? 0,
    timestamp: Math.floor(now / 1000),
  };
}

// ── Normalization ──

function normalizeMarketWire(raw: Record<string, unknown>): PolymarketMarket {
  const outcomes = parseJsonArray(raw.outcomes, "market.outcomes").map((value, index) => {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Polymarket market.outcomes[${index}]: non-empty string required`);
    }
    return value;
  });
  const outcomePrices = parseJsonArray(raw.outcomePrices, "market.outcomePrices").map(
    (value, index) => {
      const price = toNumber(value, `market.outcomePrices[${index}]`);
      if (price < 0 || price > 1) {
        throw new Error(`Polymarket market.outcomePrices[${index}]: probability out of range`);
      }
      return price;
    },
  );
  if (outcomes.length !== outcomePrices.length || outcomes.length < 2) {
    throw new Error("Polymarket market outcomes/prices length mismatch");
  }

  return {
    id: requiredString(raw.id, "market.id"),
    slug: requiredString(raw.slug, "market.slug"),
    question: requiredString(raw.question, "market.question"),
    description: raw.description ? String(raw.description) : undefined,
    conditionId: requiredString(raw.conditionId, "market.conditionId"),
    resolutionSource: raw.resolutionSource ? String(raw.resolutionSource) : undefined,
    outcomes,
    outcomePrices,
    volume: toOptionalNumber(raw.volume, "market.volume"),
    volume24hr: toOptionalNumber(raw.volume24hr, "market.volume24hr"),
    volume1wk: toOptionalNumber(raw.volume1wk, "market.volume1wk"),
    volume1mo: toOptionalNumber(raw.volume1mo, "market.volume1mo"),
    liquidity: toOptionalNumber(raw.liquidity, "market.liquidity"),
    liquidityClob: toOptionalNumber(raw.liquidityClob, "market.liquidityClob"),
    openInterest: toOptionalNumber(raw.openInterest, "market.openInterest"),
    lastTradePrice: toOptionalNumber(raw.lastTradePrice, "market.lastTradePrice"),
    bestBid: raw.bestBid != null ? toNumber(raw.bestBid, "market.bestBid") : undefined,
    bestAsk: raw.bestAsk != null ? toNumber(raw.bestAsk, "market.bestAsk") : undefined,
    spread: raw.spread != null ? toNumber(raw.spread, "market.spread") : undefined,
    sportsMarketType:
      typeof raw.sportsMarketType === "string" ? raw.sportsMarketType : undefined,
    active: toBoolean(raw.active, "market.active"),
    closed: toBoolean(raw.closed, "market.closed"),
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    endDate: raw.endDate ? String(raw.endDate) : undefined,
  };
}

function normalizeEventWire(raw: Record<string, unknown>): PolymarketEvent {
  const marketRows = Array.isArray(raw.markets)
    ? (raw.markets as Record<string, unknown>[])
    : [];
  return {
    id: requiredString(raw.id, "event.id"),
    ticker: String(raw.ticker ?? ""),
    slug: requiredString(raw.slug, "event.slug"),
    title: requiredString(raw.title, "event.title"),
    description: raw.description ? String(raw.description) : undefined,
    volume: toOptionalNumber(raw.volume, "event.volume"),
    volume24hr: toOptionalNumber(raw.volume24hr, "event.volume24hr"),
    openInterest: toOptionalNumber(raw.openInterest, "event.openInterest"),
    liquidity: toOptionalNumber(raw.liquidity, "event.liquidity"),
    liquidityClob: toOptionalNumber(raw.liquidityClob, "event.liquidityClob"),
    active: toBoolean(raw.active, "event.active"),
    closed: toBoolean(raw.closed, "event.closed"),
    startDate: raw.startDate ? String(raw.startDate) : undefined,
    endDate: raw.endDate ? String(raw.endDate) : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
    markets: marketRows.map(normalizeMarketWire),
  };
}

// ── Line-movement detection ──

export type LineTrackerOptions = {
  /** Basis-point threshold to flag a line move (default: 500 = 5%). */
  deltaBpThreshold?: number;
  /** Minimum volume required to consider a move significant (default: 1000). */
  minVolume24hr?: number;
  /** Detection window in seconds (default: 300). */
  windowSeconds?: number;
  /** Minimum spread to consider market liquid enough (default: 0.005 = 0.5¢). */
  maxSpread?: number;
};

export class PolymarketLineTracker {
  private history = new Map<string, PolymarketTick[]>();
  private readonly deltaBpThreshold: number;
  private readonly minVolume24hr: number;
  private readonly windowSeconds: number;
  private readonly maxSpread: number;

  constructor(options: LineTrackerOptions = {}) {
    this.deltaBpThreshold = options.deltaBpThreshold ?? 500; // 5%
    this.minVolume24hr = options.minVolume24hr ?? 1000;
    this.windowSeconds = options.windowSeconds ?? 300;
    this.maxSpread = options.maxSpread ?? 0.05;
  }

  /** Ingest a tick and return any detected line moves. */
  ingest(tick: PolymarketTick): PolymarketLineMove[] {
    const series = this.history.get(tick.slug) ?? [];
    const cutoff = tick.timestamp - this.windowSeconds;

    // Keep only ticks within the window
    const window = series.filter((t) => t.timestamp >= cutoff);
    window.push(tick);
    this.history.set(tick.slug, window);

    if (window.length < 2) return [];

    // Compare against the oldest tick in the window
    const baseline = window[0];
    const moves: PolymarketLineMove[] = [];

    const oldPrice = baseline.yesPrice;
    const newPrice = tick.yesPrice;
    const deltaAbs = newPrice - oldPrice;
    const deltaBp = oldPrice > 0 ? Math.round((deltaAbs / oldPrice) * 10_000) : 0;

    const exceedsThreshold = Math.abs(deltaBp) >= this.deltaBpThreshold;
    const liquidEnough = (tick.volume24hr ?? 0) >= this.minVolume24hr;
    const tightSpread = tick.spread <= this.maxSpread;

    if (exceedsThreshold && liquidEnough && tightSpread) {
      moves.push({
        slug: tick.slug,
        direction: deltaAbs > 0 ? "up" : deltaAbs < 0 ? "down" : "flat",
        oldPrice: Number(oldPrice.toFixed(4)),
        newPrice: Number(newPrice.toFixed(4)),
        deltaBp,
        deltaAbs: Number(Math.abs(deltaAbs).toFixed(4)),
        volumeAtMove: tick.volume24hr ?? 0,
        detectedAt: tick.timestamp,
        windowSeconds: this.windowSeconds,
      });
    }

    return moves;
  }

  /** Reset all tracked history (useful for testing or scheduled resets). */
  reset(): void {
    this.history.clear();
  }

  /** Snapshot of current tracked slugs and tick counts. */
  status(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [slug, ticks] of this.history) {
      out[slug] = ticks.length;
    }
    return out;
  }
}
