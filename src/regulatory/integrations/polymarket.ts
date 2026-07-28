/**
 * Polymarket Gamma API client — public market data ingestion.
 *
 * No auth required for read-only endpoints.
 * @see https://docs.polymarket.com/
 */

import { OFFICIAL_URLS } from "../../institutions/official-urls.ts";

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
  volume?: number;
  volume24hr?: number;
  openInterest?: number;
  liquidityClob?: number;
  createdAt?: string;
  updatedAt?: string;
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
  volume: number;
  volume24hr: number;
  volume1wk: number;
  volume1mo: number;
  liquidity: number;
  liquidityClob: number;
  openInterest?: number;
  lastTradePrice: number;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
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
};

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
): Promise<T> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Polymarket API ${url}: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Parse JSON array fields that Polymarket returns as strings. */
function parseJsonField<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T[];
    } catch {
      return [];
    }
  }
  return [];
}

function toNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

// ── Public fetch functions ──

export type FetchMarketsOptions = {
  limit?: number;
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
  if (options.active !== undefined) params.set("active", String(options.active));
  if (options.closed !== undefined) params.set("closed", String(options.closed));

  const url = `${base}/markets?${params.toString()}`;
  const raw = await getJson<Record<string, unknown>[]>(fetchImpl, url);

  return raw.map(normalizeMarketWire);
}

/** Fetch a single market by its numeric ID. */
export async function fetchPolymarketMarket(
  marketId: string,
  options: PolymarketClientOptions = {},
): Promise<PolymarketMarket> {
  const fetchImpl = resolveFetch(options);
  const base = resolveBaseUrl(options.baseUrl);
  const url = `${base}/markets/${encodeURIComponent(marketId)}`;
  const raw = await getJson<Record<string, unknown>>(fetchImpl, url);
  return normalizeMarketWire(raw);
}

/** Build a tick snapshot from a market object. */
export function marketToTick(market: PolymarketMarket, now = Date.now()): PolymarketTick {
  const prices = market.outcomePrices;
  const yesPrice = prices[0] ?? market.lastTradePrice ?? 0;
  const noPrice = prices[1] ?? (1 - yesPrice);
  return {
    slug: market.slug,
    yesPrice: Number(yesPrice.toFixed(4)),
    noPrice: Number(noPrice.toFixed(4)),
    bestBid: market.bestBid ?? yesPrice,
    bestAsk: market.bestAsk ?? yesPrice,
    spread: market.spread ?? Math.abs((market.bestAsk ?? yesPrice) - (market.bestBid ?? yesPrice)),
    volume24hr: market.volume24hr,
    volumeTotal: market.volume,
    liquidity: market.liquidityClob ?? market.liquidity,
    timestamp: Math.floor(now / 1000),
  };
}

// ── Normalization ──

function normalizeMarketWire(raw: Record<string, unknown>): PolymarketMarket {
  const outcomes = parseJsonField<string>(raw.outcomes);
  const outcomePrices = parseJsonField<string | number>(raw.outcomePrices).map(toNumber);

  // Build event from nested events array or single event field
  const events = (raw.events as PolymarketEvent[] | undefined) ?? [];
  const event = events[0] ?? (raw.event as PolymarketEvent | undefined);

  return {
    id: String(raw.id ?? ""),
    slug: String(raw.slug ?? ""),
    question: String(raw.question ?? ""),
    description: raw.description ? String(raw.description) : undefined,
    conditionId: String(raw.conditionId ?? ""),
    resolutionSource: raw.resolutionSource ? String(raw.resolutionSource) : undefined,
    outcomes,
    outcomePrices,
    volume: toNumber(raw.volume),
    volume24hr: toNumber(raw.volume24hr),
    volume1wk: toNumber(raw.volume1wk),
    volume1mo: toNumber(raw.volume1mo),
    liquidity: toNumber(raw.liquidity),
    liquidityClob: toNumber(raw.liquidityClob),
    openInterest: raw.openInterest ? toNumber(raw.openInterest) : undefined,
    lastTradePrice: toNumber(raw.lastTradePrice),
    bestBid: raw.bestBid ? toNumber(raw.bestBid) : undefined,
    bestAsk: raw.bestAsk ? toNumber(raw.bestAsk) : undefined,
    spread: raw.spread ? toNumber(raw.spread) : undefined,
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    endDate: raw.endDate ? String(raw.endDate) : undefined,
    event,
    events,
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
    const liquidEnough = tick.volume24hr >= this.minVolume24hr;
    const tightSpread = tick.spread <= this.maxSpread;

    if (exceedsThreshold && liquidEnough && tightSpread) {
      moves.push({
        slug: tick.slug,
        direction: deltaAbs > 0 ? "up" : deltaAbs < 0 ? "down" : "flat",
        oldPrice: Number(oldPrice.toFixed(4)),
        newPrice: Number(newPrice.toFixed(4)),
        deltaBp,
        deltaAbs: Number(Math.abs(deltaAbs).toFixed(4)),
        volumeAtMove: tick.volume24hr,
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
