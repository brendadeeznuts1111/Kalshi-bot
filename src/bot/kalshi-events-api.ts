// @see https://docs.kalshi.com/api-reference/market/get-markets
// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
import {
  asKalshiEventTicker,
  asKalshiMarketTicker,
  asSeriesTicker,
  tryCompetitorId,
  type CompetitorId,
  type KalshiEventTicker,
  type KalshiMarketTicker,
  type SeriesTicker,
  unbrand,
} from "../institutions/event-store/brands.ts";
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";
import { fetchWithRetry, type RetryOptions } from "../institutions/resilient-fetch.ts";
import {
  IDENTITY,
  type IdentityFieldKey,
} from "../institutions/market-registry/brands.ts";

export type KalshiFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type KalshiMarketWire = {
  ticker: KalshiMarketTicker;
  event_ticker: KalshiEventTicker;
  title?: string | undefined;
  market_type?: string | undefined;
  status: string;
  yes_sub_title?: string | undefined;
  no_sub_title?: string | undefined;
  volume_fp?: string | undefined;
  /** Trailing 24h contract volume — capacity/flow, not lifetime vanity. */
  volume_24h_fp?: string | undefined;
  open_interest_fp?: string | undefined;
  yes_bid_dollars?: string | undefined;
  yes_ask_dollars?: string | undefined;
  no_bid_dollars?: string | undefined;
  no_ask_dollars?: string | undefined;
  last_price_dollars?: string | undefined;
  /** Resting size at best YES bid (contracts). */
  yes_bid_size_fp?: string | undefined;
  /** Resting size at best YES ask (contracts). */
  yes_ask_size_fp?: string | undefined;
  occurrence_datetime?: string | undefined;
  close_time?: string | undefined;
  updated_time?: string | undefined;
  expected_expiration_time?: string | undefined;
  rules_primary?: string | undefined;
  rules_secondary?: string | undefined;
  custom_strike?: {
    tennis_competitor?: CompetitorId;
    tennis_doubles_competitor?: CompetitorId;
    table_tennis_competitor?: CompetitorId;
  } | undefined;
  result?: string | undefined;
};

export type KalshiMarketsPage = {
  markets: KalshiMarketWire[];
  cursor?: string | undefined;
};

export type KalshiEventWire = {
  event_ticker: KalshiEventTicker;
  title?: string | undefined;
  sub_title?: string | undefined;
  series_ticker?: SeriesTicker | undefined;
  category?: string | undefined;
  mutually_exclusive?: boolean | undefined;
  product_metadata?: { competition?: string | undefined; competition_scope?: string | undefined } | undefined;
};

export type KalshiEventResponse = {
  event: KalshiEventWire;
  markets: KalshiMarketWire[];
};

export type KalshiInventoryEvent = {
  event_ticker: KalshiEventTicker;
  series_ticker: SeriesTicker;
  title: string;
  sub_title?: string;
  last_updated_ts?: string;
  markets: KalshiMarketWire[];
};

export type KalshiEventsPage = {
  events: KalshiInventoryEvent[];
  nextCursor?: string;
};

export type FetchKalshiEventsPageOptions = Omit<RetryOptions, "fetchImpl"> & {
  seriesTicker: SeriesTicker;
  status?: string;
  limit: number;
  cursor?: string;
  baseUrl?: string;
  fetchImpl?: KalshiFetchImpl;
};

function resolveBaseUrl(explicit?: string): string {
  return (
    explicit?.replace(/\/$/, "") ??
    Bun.env.KALSHI_API_BASE?.trim().replace(/\/$/, "") ??
    OFFICIAL_URLS.kalshi.tradeApiV2Base
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseKalshiMarketWire(raw: unknown): KalshiMarketWire | null {
  if (!isRecord(raw)) return null;
  const ticker = typeof raw.ticker === "string" ? raw.ticker : null;
  const event_ticker = typeof raw.event_ticker === "string" ? raw.event_ticker : null;
  const status = typeof raw.status === "string" ? raw.status : null;
  if (!ticker || !event_ticker || !status) return null;
  const custom = isRecord(raw.custom_strike) ? raw.custom_strike : undefined;
  const tennisCompetitor =
    custom && typeof custom.tennis_competitor === "string"
      ? tryCompetitorId(custom.tennis_competitor)
      : undefined;
  const tennisDoublesCompetitor =
    custom && typeof custom.tennis_doubles_competitor === "string"
      ? tryCompetitorId(custom.tennis_doubles_competitor)
      : undefined;
  const tableTennisCompetitor =
    custom && typeof custom.table_tennis_competitor === "string"
      ? tryCompetitorId(custom.table_tennis_competitor)
      : undefined;
  const customStrike =
    tennisCompetitor || tennisDoublesCompetitor || tableTennisCompetitor
      ? {
          ...(tennisCompetitor ? { tennis_competitor: tennisCompetitor } : {}),
          ...(tennisDoublesCompetitor
            ? { tennis_doubles_competitor: tennisDoublesCompetitor }
            : {}),
          ...(tableTennisCompetitor
            ? { table_tennis_competitor: tableTennisCompetitor }
            : {}),
        }
      : undefined;
  return {
    ticker: asKalshiMarketTicker(ticker),
    event_ticker: asKalshiEventTicker(event_ticker),
    title: typeof raw.title === "string" ? raw.title : undefined,
    market_type: typeof raw.market_type === "string" ? raw.market_type : undefined,
    status,
    yes_sub_title: typeof raw.yes_sub_title === "string" ? raw.yes_sub_title : undefined,
    no_sub_title: typeof raw.no_sub_title === "string" ? raw.no_sub_title : undefined,
    volume_fp: typeof raw.volume_fp === "string" ? raw.volume_fp : undefined,
    volume_24h_fp: typeof raw.volume_24h_fp === "string" ? raw.volume_24h_fp : undefined,
    open_interest_fp: typeof raw.open_interest_fp === "string" ? raw.open_interest_fp : undefined,
    yes_bid_dollars: typeof raw.yes_bid_dollars === "string" ? raw.yes_bid_dollars : undefined,
    yes_ask_dollars: typeof raw.yes_ask_dollars === "string" ? raw.yes_ask_dollars : undefined,
    no_bid_dollars: typeof raw.no_bid_dollars === "string" ? raw.no_bid_dollars : undefined,
    no_ask_dollars: typeof raw.no_ask_dollars === "string" ? raw.no_ask_dollars : undefined,
    last_price_dollars:
      typeof raw.last_price_dollars === "string" ? raw.last_price_dollars : undefined,
    yes_bid_size_fp: typeof raw.yes_bid_size_fp === "string" ? raw.yes_bid_size_fp : undefined,
    yes_ask_size_fp: typeof raw.yes_ask_size_fp === "string" ? raw.yes_ask_size_fp : undefined,
    occurrence_datetime:
      typeof raw.occurrence_datetime === "string" ? raw.occurrence_datetime : undefined,
    close_time: typeof raw.close_time === "string" ? raw.close_time : undefined,
    updated_time: typeof raw.updated_time === "string" ? raw.updated_time : undefined,
    expected_expiration_time:
      typeof raw.expected_expiration_time === "string" ? raw.expected_expiration_time : undefined,
    rules_primary: typeof raw.rules_primary === "string" ? raw.rules_primary : undefined,
    rules_secondary: typeof raw.rules_secondary === "string" ? raw.rules_secondary : undefined,
    custom_strike: customStrike,
    result: typeof raw.result === "string" ? raw.result : undefined,
  };
}

/** Resolve the participant identifier using the registry-declared source field. */
export function competitorIdForMarket(
  market: KalshiMarketWire,
  identityField: IdentityFieldKey,
): CompetitorId | undefined {
  if (identityField === IDENTITY.tennisCompetitor) {
    return market.custom_strike?.tennis_competitor;
  }
  if (identityField === IDENTITY.tennisDoublesCompetitor) {
    return market.custom_strike?.tennis_doubles_competitor;
  }
  if (identityField === IDENTITY.tableTennisCompetitor) {
    return market.custom_strike?.table_tennis_competitor;
  }
  return undefined;
}

/** Fetch one event page with atomic nested markets for retirement-safe inventory. */
export async function fetchKalshiEventsPageWire(
  options: FetchKalshiEventsPageOptions,
): Promise<unknown> {
  if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 200) {
    throw new Error("Kalshi events page limit must be a safe integer in [1, 200]");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const params = new URLSearchParams({
    series_ticker: unbrand(options.seriesTicker),
    status: options.status ?? "open",
    with_nested_markets: "true",
    limit: String(options.limit),
  });
  if (options.cursor) params.set("cursor", options.cursor);
  const {
    seriesTicker: _,
    status: __,
    limit: ___,
    cursor: ____,
    baseUrl: _____,
    fetchImpl: ______,
    ...retryOptions
  } = options;
  const response = await fetchWithRetry(
    `${base}/events?${params.toString()}`,
    { headers: { Accept: "application/json" } },
    { ...retryOptions, fetchImpl },
  );
  if (!response.ok) {
    throw new Error(`Kalshi events: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

/** Strict parse-once boundary. No malformed row may masquerade as empty inventory. */
export function parseKalshiEventsPageWire(
  raw: unknown,
  expectedSeries: SeriesTicker,
): KalshiEventsPage {
  if (!isRecord(raw) || !Array.isArray(raw.events)) {
    throw new Error("Kalshi events page: events array required");
  }
  if (typeof raw.cursor !== "string") {
    throw new Error("Kalshi events page: cursor string required");
  }
  const eventIds = new Set<string>();
  const events = raw.events.map((value, eventIndex): KalshiInventoryEvent => {
    if (!isRecord(value)) throw new Error(`Kalshi events[${eventIndex}]: object required`);
    const eventTicker = requiredWireString(value.event_ticker, `events[${eventIndex}].event_ticker`);
    const seriesTicker = requiredWireString(
      value.series_ticker,
      `events[${eventIndex}].series_ticker`,
    );
    if (seriesTicker !== unbrand(expectedSeries)) {
      throw new Error(`Kalshi events[${eventIndex}]: series selector drift`);
    }
    if (eventIds.has(eventTicker)) {
      throw new Error(`Kalshi events page: duplicate event ${eventTicker}`);
    }
    eventIds.add(eventTicker);
    if (!Array.isArray(value.markets)) {
      throw new Error(`Kalshi events[${eventIndex}].markets array required`);
    }
    if (value.markets.length === 0) {
      throw new Error(`Kalshi events[${eventIndex}].markets must not be empty`);
    }
    const marketIds = new Set<string>();
    const markets = value.markets.map((market, marketIndex) => {
      const parsed = parseStrictNestedMarket(market, eventIndex, marketIndex);
      if (unbrand(parsed.event_ticker) !== eventTicker) {
        throw new Error(`Kalshi events[${eventIndex}].markets[${marketIndex}]: parent drift`);
      }
      const marketTicker = unbrand(parsed.ticker);
      if (marketIds.has(marketTicker)) {
        throw new Error(`Kalshi events[${eventIndex}]: duplicate market ${marketTicker}`);
      }
      marketIds.add(marketTicker);
      return parsed;
    });
    return {
      event_ticker: asKalshiEventTicker(eventTicker),
      series_ticker: asSeriesTicker(seriesTicker),
      title: requiredWireString(value.title, `events[${eventIndex}].title`),
      ...optionalWireField(value, "sub_title", `events[${eventIndex}].sub_title`),
      ...optionalWireField(value, "last_updated_ts", `events[${eventIndex}].last_updated_ts`),
      markets,
    };
  });
  return {
    events,
    ...(raw.cursor ? { nextCursor: raw.cursor } : {}),
  };
}

function parseStrictNestedMarket(
  raw: unknown,
  eventIndex: number,
  marketIndex: number,
): KalshiMarketWire {
  const label = `events[${eventIndex}].markets[${marketIndex}]`;
  if (!isRecord(raw)) throw new Error(`Kalshi ${label}: object required`);
  const parsed = parseKalshiMarketWire(raw);
  if (!parsed) throw new Error(`Kalshi ${label}: ticker, event_ticker, and status required`);
  parsed.title = requiredWireString(raw.title, `${label}.title`);
  parsed.market_type = requiredWireString(raw.market_type, `${label}.market_type`);
  for (const field of [
    "yes_sub_title",
    "no_sub_title",
    "volume_fp",
    "volume_24h_fp",
    "open_interest_fp",
    "yes_bid_dollars",
    "yes_ask_dollars",
    "no_bid_dollars",
    "no_ask_dollars",
    "last_price_dollars",
    "yes_bid_size_fp",
    "yes_ask_size_fp",
    "occurrence_datetime",
    "close_time",
    "updated_time",
    "expected_expiration_time",
    "rules_primary",
    "rules_secondary",
    "result",
  ] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== "string") {
      throw new Error(`Kalshi ${label}.${field}: string required`);
    }
  }
  if (isRecord(raw.custom_strike)) {
    for (const field of [
      "tennis_competitor",
      "tennis_doubles_competitor",
      "table_tennis_competitor",
    ] as const) {
      if (raw.custom_strike[field] !== undefined) {
        if (typeof raw.custom_strike[field] !== "string" || !tryCompetitorId(raw.custom_strike[field])) {
          throw new Error(`Kalshi ${label}.custom_strike.${field}: valid competitor id required`);
        }
      }
    }
  } else if (raw.custom_strike !== undefined && raw.custom_strike !== null) {
    throw new Error(`Kalshi ${label}.custom_strike: object required`);
  }
  return parsed;
}

function requiredWireString(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`Kalshi ${field}: string required`);
  return raw.trim();
}

function optionalWireField<Key extends "sub_title" | "last_updated_ts">(
  row: Record<string, unknown>,
  key: Key,
  field: string,
): Partial<Record<Key, string>> {
  const raw = row[key];
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "string") throw new Error(`Kalshi ${field}: string required`);
  return { [key]: raw } as Partial<Record<Key, string>>;
}

export type KalshiMarketsQuery = {
  series_ticker?: SeriesTicker;
  status?: string;
  limit?: number;
  cursor?: string | undefined;
  event_ticker?: KalshiEventTicker;
  /** Unix seconds — closed markets closed at/after this time. */
  min_close_ts?: number;
  /** Unix seconds — closed markets closed at/before this time. */
  max_close_ts?: number;
  /** Unix seconds — settled markets settled at/after this time. */
  min_settled_ts?: number;
  /** Unix seconds — settled markets settled at/before this time. */
  max_settled_ts?: number;
};

export async function fetchKalshiMarketsPage(
  params: KalshiMarketsQuery,
  options: { baseUrl?: string | undefined; fetchImpl?: KalshiFetchImpl | undefined } = {},
): Promise<KalshiMarketsPage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const q = new URLSearchParams();
  if (params.series_ticker) q.set("series_ticker", unbrand(params.series_ticker));
  if (params.status) q.set("status", params.status);
  if (params.event_ticker) q.set("event_ticker", unbrand(params.event_ticker));
  if (params.min_close_ts != null) q.set("min_close_ts", String(params.min_close_ts));
  if (params.max_close_ts != null) q.set("max_close_ts", String(params.max_close_ts));
  if (params.min_settled_ts != null) q.set("min_settled_ts", String(params.min_settled_ts));
  if (params.max_settled_ts != null) q.set("max_settled_ts", String(params.max_settled_ts));
  q.set("limit", String(params.limit ?? 200));
  if (params.cursor) q.set("cursor", params.cursor);
  const res = await fetchImpl(`${base}/markets?${q}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Kalshi markets: ${res.status} ${res.statusText}`);
  const body: unknown = await res.json();
  if (!isRecord(body) || !Array.isArray(body.markets)) return { markets: [] };
  const markets = body.markets
    .map(parseKalshiMarketWire)
    .filter((m): m is KalshiMarketWire => m != null);
  return {
    markets,
    cursor: typeof body.cursor === "string" ? body.cursor : undefined,
  };
}

export async function fetchAllKalshiMarkets(
  params: Omit<Parameters<typeof fetchKalshiMarketsPage>[0], "cursor">,
  options: { baseUrl?: string | undefined; fetchImpl?: KalshiFetchImpl | undefined; maxPages?: number } = {},
): Promise<KalshiMarketWire[]> {
  const maxPages = options.maxPages ?? 50;
  const out: KalshiMarketWire[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchKalshiMarketsPage({ ...params, cursor }, options);
    out.push(...batch.markets);
    cursor = batch.cursor;
    if (!cursor || batch.markets.length === 0) break;
  }
  return out;
}

/**
 * Public GET /markets/{ticker} — volume + sizes for a single market (no auth).
 * @see https://docs.kalshi.com/api-reference/market/get-market
 */
export async function fetchKalshiMarket(
  ticker: KalshiMarketTicker,
  options: { baseUrl?: string; fetchImpl?: KalshiFetchImpl } = {},
): Promise<KalshiMarketWire | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const res = await fetchImpl(`${base}/markets/${encodeURIComponent(unbrand(ticker))}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Kalshi market ${unbrand(ticker)}: ${res.status} ${res.statusText}`);
  }
  const body: unknown = await res.json();
  // Wire may be { market: {...} } or the market object itself.
  const raw = isRecord(body) && isRecord(body.market) ? body.market : body;
  return parseKalshiMarketWire(raw);
}

export async function fetchKalshiEvent(
  eventTicker: KalshiEventTicker,
  options: { baseUrl?: string | undefined; fetchImpl?: KalshiFetchImpl | undefined } = {},
): Promise<KalshiEventResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const res = await fetchImpl(`${base}/events/${encodeURIComponent(unbrand(eventTicker))}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Kalshi event ${unbrand(eventTicker)}: ${res.status} ${res.statusText}`);
  const body: unknown = await res.json();
  if (!isRecord(body) || !isRecord(body.event) || !Array.isArray(body.markets)) {
    throw new Error(`Kalshi event ${unbrand(eventTicker)}: invalid wire`);
  }
  const rawEvent = body.event;
  const eventTickerWire =
    typeof rawEvent.event_ticker === "string" ? asKalshiEventTicker(rawEvent.event_ticker) : eventTicker;
  const seriesTicker =
    typeof rawEvent.series_ticker === "string" ? asSeriesTicker(rawEvent.series_ticker) : undefined;
  const event: KalshiEventWire = {
    event_ticker: eventTickerWire,
    title: typeof rawEvent.title === "string" ? rawEvent.title : undefined,
    sub_title: typeof rawEvent.sub_title === "string" ? rawEvent.sub_title : undefined,
    series_ticker: seriesTicker,
    category: typeof rawEvent.category === "string" ? rawEvent.category : undefined,
    mutually_exclusive:
      typeof rawEvent.mutually_exclusive === "boolean" ? rawEvent.mutually_exclusive : undefined,
    product_metadata: isRecord(rawEvent.product_metadata)
      ? {
          competition:
            typeof rawEvent.product_metadata.competition === "string"
              ? rawEvent.product_metadata.competition
              : undefined,
          competition_scope:
            typeof rawEvent.product_metadata.competition_scope === "string"
              ? rawEvent.product_metadata.competition_scope
              : undefined,
        }
      : undefined,
  };
  const markets = body.markets
    .map(parseKalshiMarketWire)
    .filter((m): m is KalshiMarketWire => m != null);
  return { event, markets };
}
