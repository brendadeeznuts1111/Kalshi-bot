/** Branded domain strings — tennis event-store SSOT. Parse at wire/CLI edges only. */

export type CanonicalEventId = string & { readonly __brand: unique symbol };

export function asCanonicalEventId(raw: string): CanonicalEventId {
  const id = raw.trim();
  if (!id) throw new Error("CanonicalEventId required");
  return id as CanonicalEventId;
}

export function tryCanonicalEventId(raw: string | undefined | null): CanonicalEventId | undefined {
  if (!raw?.trim()) return undefined;
  return asCanonicalEventId(raw);
}

export function parseCanonicalEventId(raw: unknown): CanonicalEventId {
  if (typeof raw !== "string") throw new Error("CanonicalEventId: expected string");
  return asCanonicalEventId(raw);
}

export type MarketId = string & { readonly __brand: unique symbol };

export function asMarketId(raw: string): MarketId {
  const id = raw.trim();
  if (!id) throw new Error("MarketId required");
  return id as MarketId;
}

export function tryMarketId(raw: string | undefined | null): MarketId | undefined {
  if (!raw?.trim()) return undefined;
  return asMarketId(raw);
}

export function parseMarketId(raw: unknown): MarketId {
  if (typeof raw !== "string") throw new Error("MarketId: expected string");
  return asMarketId(raw);
}

export type CompetitorId = string & { readonly __brand: unique symbol };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asCompetitorId(raw: string): CompetitorId {
  const id = raw.trim();
  if (!id) throw new Error("CompetitorId required");
  if (!UUID_RE.test(id)) throw new Error(`CompetitorId: invalid UUID: ${id}`);
  return id as CompetitorId;
}

export function tryCompetitorId(raw: string | undefined | null): CompetitorId | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return asCompetitorId(raw);
  } catch {
    return undefined;
  }
}

export function parseCompetitorId(raw: unknown): CompetitorId {
  if (typeof raw !== "string") throw new Error("CompetitorId: expected string");
  return asCompetitorId(raw);
}

export type MilestoneId = string & { readonly __brand: unique symbol };

export function asMilestoneId(raw: string): MilestoneId {
  const id = raw.trim();
  if (!id) throw new Error("MilestoneId required");
  if (!UUID_RE.test(id)) throw new Error(`MilestoneId: invalid UUID: ${id}`);
  return id as MilestoneId;
}

export function tryMilestoneId(raw: string | undefined | null): MilestoneId | undefined {
  if (!raw?.trim()) return undefined;
  try {
    return asMilestoneId(raw);
  } catch {
    return undefined;
  }
}

export function parseMilestoneId(raw: unknown): MilestoneId {
  if (typeof raw !== "string") throw new Error("MilestoneId: expected string");
  return asMilestoneId(raw);
}

export type KalshiMarketTicker = string & { readonly __brand: unique symbol };

export function asKalshiMarketTicker(raw: string): KalshiMarketTicker {
  const t = raw.trim();
  if (!t) throw new Error("KalshiMarketTicker required");
  return t as KalshiMarketTicker;
}

export function tryKalshiMarketTicker(raw: string | undefined | null): KalshiMarketTicker | undefined {
  if (!raw?.trim()) return undefined;
  return asKalshiMarketTicker(raw);
}

export function parseKalshiMarketTicker(raw: unknown): KalshiMarketTicker {
  if (typeof raw !== "string") throw new Error("KalshiMarketTicker: expected string");
  return asKalshiMarketTicker(raw);
}

export type KalshiEventTicker = string & { readonly __brand: unique symbol };

export function asKalshiEventTicker(raw: string): KalshiEventTicker {
  const t = raw.trim();
  if (!t) throw new Error("KalshiEventTicker required");
  return t as KalshiEventTicker;
}

export function tryKalshiEventTicker(raw: string | undefined | null): KalshiEventTicker | undefined {
  if (!raw?.trim()) return undefined;
  return asKalshiEventTicker(raw);
}

export function parseKalshiEventTicker(raw: unknown): KalshiEventTicker {
  if (typeof raw !== "string") throw new Error("KalshiEventTicker: expected string");
  return asKalshiEventTicker(raw);
}

export type SeriesTicker = string & { readonly __brand: unique symbol };

export function asSeriesTicker(raw: string): SeriesTicker {
  const t = raw.trim();
  if (!t) throw new Error("SeriesTicker required");
  return t as SeriesTicker;
}

export function trySeriesTicker(raw: string | undefined | null): SeriesTicker | undefined {
  if (!raw?.trim()) return undefined;
  return asSeriesTicker(raw);
}

export function parseSeriesTicker(raw: unknown): SeriesTicker {
  if (typeof raw !== "string") throw new Error("SeriesTicker: expected string");
  return asSeriesTicker(raw);
}

/** Kalshi venue market row key: `kalshi:${marketTicker}`. */
export function kalshiMarketId(ticker: KalshiMarketTicker): MarketId {
  return asMarketId(`kalshi:${ticker}`);
}

/** Unbrand for SQL / HTTP wire where plain string is required. */
export function unbrand<T extends string>(raw: T): string {
  return raw;
}

/** Comma-separated CLI argv → market tickers (parse once at edge). */
export function kalshiMarketTickersFromArgv(raw: string): KalshiMarketTicker[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(asKalshiMarketTicker);
}

/** Comma-separated CLI argv → event tickers (parse once at edge). */
export function kalshiEventTickersFromArgv(raw: string): KalshiEventTicker[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(asKalshiEventTicker);
}

/** Parse once when loading branded values from SQLite row columns. */
export const sqlBrand = {
  marketTicker: asKalshiMarketTicker,
  eventTicker: asKalshiEventTicker,
  eventId: asCanonicalEventId,
  seriesTicker: asSeriesTicker,
} as const;

/** JSON/cache wire → interior event tickers (e.g. canary artifact). */
export function parseKalshiEventTickersWire(raw: unknown): KalshiEventTicker[] {
  if (!Array.isArray(raw)) return [];
  const out: KalshiEventTicker[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = tryKalshiEventTicker(item);
    if (t) out.push(t);
  }
  return out;
}
