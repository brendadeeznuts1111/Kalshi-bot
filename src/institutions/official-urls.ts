/**
 * Canonical external URLs — verify when fee/API docs change.
 * Code cites these constants; do not hardcode stale paths in tenants.
 *
 * Last verified: 2026-07-22
 */
export const OFFICIAL_URLS = {
  kalshi: {
    home: "https://kalshi.com/",
    /** Live fee schedule page (replaces dead /docs/trading/fees). */
    feeSchedule: "https://kalshi.com/fee-schedule",
    feeSchedulePdf: "https://kalshi.com/docs/kalshi-fee-schedule.pdf",
    feeRounding: "https://docs.kalshi.com/getting_started/fee_rounding",
    eventFeeChanges: "https://docs.kalshi.com/api-reference/events/get-event-fee-changes",
    tradeApiDocs: "https://docs.kalshi.com/",
    tradeApiV2: "https://docs.kalshi.com/api-reference",
    /** Public market data (all markets, no auth). Override with KALSHI_API_BASE. */
    tradeApiV2Base: "https://external-api.kalshi.com/trade-api/v2",
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
  bun: {
    create: "https://bun.com/docs/runtime/templating/create",
    test: "https://bun.com/docs/test/index#run-tests",
    sqlite: "https://bun.com/docs/runtime/sqlite",
    fetch: "https://bun.com/docs/runtime/networking/fetch#sending-an-http-request",
    cryptoHasher: "https://bun.com/docs/runtime/hashing#bun-cryptohasher",
  },
} as const;

export type OfficialUrlCategory = keyof typeof OFFICIAL_URLS;
