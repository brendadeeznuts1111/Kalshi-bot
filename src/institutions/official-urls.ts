/**
 * Canonical external URLs — verify when fee/API docs change.
 * Code cites these constants; do not hardcode stale paths in tenants.
 *
 * Last verified: 2026-07-31
 * Note: portfolio endpoints now ship fixed-point fields (*_fp, *_dollars)
 * alongside legacy integer cents — parse via institutions/ledger-types.ts.
 * No programmatic deposit/withdraw endpoints exist (bank rails only).
 *
 * Liveness: bare API roots often 404 — use OFFICIAL_URL_PROBES for path suffixes
 * that return a real HTTP response (200/401 = host alive).
 *
 * @see scripts/validate-glossary-urls.ts
 * @see docs/OFFICIAL_URLS.md
 */
export const OFFICIAL_URLS = {
  kalshi: {
    home: "https://kalshi.com/",
    /** Live fee schedule page (replaces dead /docs/trading/fees). */
    feeSchedule: "https://kalshi.com/fee-schedule",
    feeSchedulePdf: "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
    feeRounding: "https://docs.kalshi.com/getting_started/fee_rounding",
    eventFeeChanges: "https://docs.kalshi.com/api-reference/events/get-event-fee-changes",
    eventsList: "https://docs.kalshi.com/api-reference/events/get-events",
    eventGet: "https://docs.kalshi.com/api-reference/events/get-event",
    /** Series list docs (market namespace — not /series/). */
    seriesList: "https://docs.kalshi.com/api-reference/market/get-series-list",
    tradeApiDocs: "https://docs.kalshi.com/",
    tradeApiV2: "https://docs.kalshi.com/api-reference",
    /** Portfolio endpoint docs (balance/positions/fills shapes). */
    portfolioBalance: "https://docs.kalshi.com/api-reference/portfolio/get-balance",
    portfolioPositions: "https://docs.kalshi.com/api-reference/portfolio/get-positions",
    portfolioFills: "https://docs.kalshi.com/api-reference/portfolio/get-fills",
    /** Orders live under /orders (not /portfolio/orders docs page). */
    portfolioOrders: "https://docs.kalshi.com/api-reference/orders/get-orders",
    exchangeStatus: "https://docs.kalshi.com/api-reference/exchange/get-exchange-status",
    /** Public market data (all markets, no auth). Override with KALSHI_API_BASE.
     *  Canonical prod host — external-api.kalshi.com hard-403s since 2026-08-01
     *  (edge block, all clients); api.elections.kalshi.com serves the full v2 API. */
    tradeApiV2Base: "https://api.elections.kalshi.com/trade-api/v2",
    /** Demo environment — no real money. */
    tradeApiV2BaseDemo: "https://external-api.demo.kalshi.co/trade-api/v2",
    /** Election markets API — separate domain for CFTC-regulated event contracts. */
    tradeApiV2BaseElections: "https://api.elections.kalshi.com/trade-api/v2",
    /** Authenticated market-data WebSocket. Override with KALSHI_WS_URL. */
    tradeApiWsV2: "wss://external-api-ws.kalshi.com/trade-api/ws/v2",
    websocketQuickStart: "https://docs.kalshi.com/getting_started/quick_start_websockets",
    orderbookWs: "https://docs.kalshi.com/websockets/orderbook-updates",
    orderbookGuide: "https://docs.kalshi.com/getting_started/orderbook_responses",
  },
  oddsApi: {
    guideV4: "https://the-odds-api.com/liveapi/guides/v4/",
    apiBaseV4: "https://api.the-odds-api.com/v4",
    /** Pinnacle is bookmaker key `pinnacle` in v4 responses — not Circa. */
    pinnacleNote: "https://the-odds-api.com/sports-odds-data/bookmaker-apis.html",
  },
  github: {
    rateLimit: "https://docs.github.com/en/rest/rate-limit/rate-limit",
    codeSearch: "https://docs.github.com/en/rest/search/search#search-code",
  },
  polymarket: {
    home: "https://polymarket.com/",
    docs: "https://docs.polymarket.com/",
    gammaApiBase: "https://gamma-api.polymarket.com",
  },
  bun: {
    create: "https://bun.com/docs/runtime/templating/create",
    test: "https://bun.com/docs/test/index#run-tests",
    sqlite: "https://bun.com/docs/runtime/sqlite",
    fetch: "https://bun.com/docs/runtime/networking/fetch#sending-an-http-request",
    cryptoHasher: "https://bun.com/docs/runtime/hashing#bun-cryptohasher",
    color: "https://bun.com/docs/runtime/color",
    htmlRewriter: "https://bun.com/docs/runtime/html-rewriter",
    env: "https://bun.com/docs/runtime/environment-variables",
    urlPattern: "https://bun.com/blog/bun-v1.3.4#urlpattern-api",
    update: "https://bun.com/docs/pm/cli/update",
  },
} as const;

export type OfficialUrlCategory = keyof typeof OFFICIAL_URLS;

/**
 * Liveness probes for URLs that do not answer 200 on the bare string.
 * Key: `${category}.${key}` matching OFFICIAL_URLS paths.
 *
 * - path: appended to base URL for HTTP probe
 * - okStatuses: treat these as "host alive" (e.g. 401 without API key)
 * - skip: do not HTTP-probe (wss://, etc.)
 */
export type OfficialUrlProbe = {
  path?: string;
  okStatuses?: readonly number[];
  skip?: boolean;
};

export const OFFICIAL_URL_PROBES: Readonly<Record<string, OfficialUrlProbe>> = {
  "kalshi.tradeApiV2Base": { path: "/exchange/status" },
  "kalshi.tradeApiV2BaseDemo": { path: "/exchange/status" },
  "kalshi.tradeApiV2BaseElections": { path: "/exchange/status" },
  "kalshi.tradeApiWsV2": { skip: true },
  "oddsApi.apiBaseV4": { path: "/sports", okStatuses: [200, 401] },
  "polymarket.gammaApiBase": { path: "/events?limit=1" },
};

/** Resolve probe URL for a catalog entry (or null if skip). */
export function resolveProbeUrl(
  category: string,
  key: string,
  baseUrl: string,
): { url: string; okStatuses: readonly number[] } | null {
  if (baseUrl.startsWith("wss:") || baseUrl.startsWith("ws:")) return null;
  const probe = OFFICIAL_URL_PROBES[`${category}.${key}`];
  if (probe?.skip) return null;
  const path = probe?.path ?? "";
  const url = path
    ? baseUrl.replace(/\/$/, "") + (path.startsWith("/") ? path : `/${path}`)
    : baseUrl;
  const okStatuses = probe?.okStatuses ?? [200, 204, 301, 302, 304, 429];
  return { url, okStatuses };
}
