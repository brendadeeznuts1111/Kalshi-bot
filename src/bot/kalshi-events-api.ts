// @see https://docs.kalshi.com/api-reference/market/get-markets
// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";

export type KalshiFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type KalshiMarketWire = {
  ticker: string;
  event_ticker: string;
  status: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  volume_fp?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  occurrence_datetime?: string;
  expected_expiration_time?: string;
  rules_primary?: string;
  rules_secondary?: string;
  custom_strike?: { tennis_competitor?: string };
  result?: string;
};

export type KalshiMarketsPage = {
  markets: KalshiMarketWire[];
  cursor?: string;
};

export type KalshiEventWire = {
  event_ticker: string;
  title?: string;
  sub_title?: string;
  series_ticker?: string;
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
  return {
    ticker,
    event_ticker,
    status,
    yes_sub_title: typeof raw.yes_sub_title === "string" ? raw.yes_sub_title : undefined,
    no_sub_title: typeof raw.no_sub_title === "string" ? raw.no_sub_title : undefined,
    volume_fp: typeof raw.volume_fp === "string" ? raw.volume_fp : undefined,
    yes_bid_dollars: typeof raw.yes_bid_dollars === "string" ? raw.yes_bid_dollars : undefined,
    yes_ask_dollars: typeof raw.yes_ask_dollars === "string" ? raw.yes_ask_dollars : undefined,
    occurrence_datetime:
      typeof raw.occurrence_datetime === "string" ? raw.occurrence_datetime : undefined,
    expected_expiration_time:
      typeof raw.expected_expiration_time === "string" ? raw.expected_expiration_time : undefined,
    rules_primary: typeof raw.rules_primary === "string" ? raw.rules_primary : undefined,
    rules_secondary: typeof raw.rules_secondary === "string" ? raw.rules_secondary : undefined,
    custom_strike:
      custom && typeof custom.tennis_competitor === "string"
        ? { tennis_competitor: custom.tennis_competitor }
        : undefined,
    result: typeof raw.result === "string" ? raw.result : undefined,
  };
}

export async function fetchKalshiMarketsPage(
  params: {
    series_ticker?: string;
    status?: string;
    limit?: number;
    cursor?: string;
    event_ticker?: string;
  },
  options: { baseUrl?: string; fetchImpl?: KalshiFetchImpl } = {},
): Promise<KalshiMarketsPage> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const q = new URLSearchParams();
  if (params.series_ticker) q.set("series_ticker", params.series_ticker);
  if (params.status) q.set("status", params.status);
  if (params.event_ticker) q.set("event_ticker", params.event_ticker);
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
  eventTicker: string,
  options: { baseUrl?: string; fetchImpl?: KalshiFetchImpl } = {},
): Promise<KalshiEventResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const res = await fetchImpl(`${base}/events/${encodeURIComponent(eventTicker)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Kalshi event ${eventTicker}: ${res.status} ${res.statusText}`);
  const body: unknown = await res.json();
  if (!isRecord(body) || !isRecord(body.event) || !Array.isArray(body.markets)) {
    throw new Error(`Kalshi event ${eventTicker}: invalid wire`);
  }
  const event = body.event as KalshiEventWire;
  const markets = body.markets
    .map(parseKalshiMarketWire)
    .filter((m): m is KalshiMarketWire => m != null);
  return { event, markets };
}
