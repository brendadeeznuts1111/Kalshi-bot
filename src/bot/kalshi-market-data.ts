// @see https://docs.kalshi.com/api-reference/market/get-market-orderbook
// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";
import type { BookSnapshot } from "../institutions/alpha-signal-types.ts";
import { parseKalshiOrderbookWire } from "./kalshi-book-parse.ts";

export type KalshiFetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FetchKalshiBookOptions = {
  depth?: number;
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

/** Public endpoint — no auth required for market data. */
export async function fetchKalshiOrderbookWire(
  ticker: string,
  options: FetchKalshiBookOptions = {},
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const depth = options.depth ?? 0;
  const url = `${base}/markets/${encodeURIComponent(ticker)}/orderbook?depth=${depth}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Kalshi orderbook ${ticker}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchKalshiBookSnapshot(
  ticker: string,
  options: FetchKalshiBookOptions = {},
): Promise<BookSnapshot> {
  const wire = await fetchKalshiOrderbookWire(ticker, options);
  return parseKalshiOrderbookWire(wire);
}

export { parseKalshiOrderbookWire, midFromBookSnapshot } from "./kalshi-book-parse.ts";
