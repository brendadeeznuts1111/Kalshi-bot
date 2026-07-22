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

export type KalshiFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type KalshiMarketWire = {
  ticker: KalshiMarketTicker;
  event_ticker: KalshiEventTicker;
  status: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  volume_fp?: string;
  /** Trailing 24h contract volume — capacity/flow, not lifetime vanity. */
  volume_24h_fp?: string;
  open_interest_fp?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  /** Resting size at best YES bid (contracts). */
  yes_bid_size_fp?: string;
  /** Resting size at best YES ask (contracts). */
  yes_ask_size_fp?: string;
  occurrence_datetime?: string;
  expected_expiration_time?: string;
  rules_primary?: string;
  rules_secondary?: string;
  custom_strike?: { tennis_competitor?: CompetitorId };
  result?: string;
};

export type KalshiMarketsPage = {
  markets: KalshiMarketWire[];
  cursor?: string;
};

export type KalshiEventWire = {
  event_ticker: KalshiEventTicker;
  title?: string;
  sub_title?: string;
  series_ticker?: SeriesTicker;
  category?: string;
  mutually_exclusive?: boolean;
  product_metadata?: { competition?: string; competition_scope?: string };
};

export type KalshiEventResponse = {
  event: KalshiEventWire;
  markets: KalshiMarketWire[];
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
  return {
    ticker: asKalshiMarketTicker(ticker),
    event_ticker: asKalshiEventTicker(event_ticker),
    status,
    yes_sub_title: typeof raw.yes_sub_title === "string" ? raw.yes_sub_title : undefined,
    no_sub_title: typeof raw.no_sub_title === "string" ? raw.no_sub_title : undefined,
    volume_fp: typeof raw.volume_fp === "string" ? raw.volume_fp : undefined,
    volume_24h_fp: typeof raw.volume_24h_fp === "string" ? raw.volume_24h_fp : undefined,
    open_interest_fp: typeof raw.open_interest_fp === "string" ? raw.open_interest_fp : undefined,
    yes_bid_dollars: typeof raw.yes_bid_dollars === "string" ? raw.yes_bid_dollars : undefined,
    yes_ask_dollars: typeof raw.yes_ask_dollars === "string" ? raw.yes_ask_dollars : undefined,
    yes_bid_size_fp: typeof raw.yes_bid_size_fp === "string" ? raw.yes_bid_size_fp : undefined,
    yes_ask_size_fp: typeof raw.yes_ask_size_fp === "string" ? raw.yes_ask_size_fp : undefined,
    occurrence_datetime:
      typeof raw.occurrence_datetime === "string" ? raw.occurrence_datetime : undefined,
    expected_expiration_time:
      typeof raw.expected_expiration_time === "string" ? raw.expected_expiration_time : undefined,
    rules_primary: typeof raw.rules_primary === "string" ? raw.rules_primary : undefined,
    rules_secondary: typeof raw.rules_secondary === "string" ? raw.rules_secondary : undefined,
    custom_strike: tennisCompetitor ? { tennis_competitor: tennisCompetitor } : undefined,
    result: typeof raw.result === "string" ? raw.result : undefined,
  };
}

export type KalshiMarketsQuery = {
  series_ticker?: SeriesTicker;
  status?: string;
  limit?: number;
  cursor?: string;
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
  options: { baseUrl?: string; fetchImpl?: KalshiFetchImpl } = {},
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
  options: { baseUrl?: string; fetchImpl?: KalshiFetchImpl; maxPages?: number } = {},
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

export async function fetchKalshiEvent(
  eventTicker: KalshiEventTicker,
  options: { baseUrl?: string; fetchImpl?: KalshiFetchImpl } = {},
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
