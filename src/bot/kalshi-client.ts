// @see https://docs.kalshi.com/api-reference/orders/create-order-v2
// @see https://docs.kalshi.com/api-reference/orders/get-orders
// @see https://docs.kalshi.com/api-reference/historical/get-historical-orders
// @see https://docs.kalshi.com/getting_started/rate_limits
// @see https://bun.com/docs/runtime/environment-variables
/**
 * Shared Kalshi execution client — signed REST for orders + portfolio reads.
 * Maker-first doctrine: post_only resting entries by default.
 * Environment: KALSHI_ENV=demo|prod (default demo); prod additionally requires
 * KALSHI_PROD_ARMED=1. Tenants import this; harness research code must not
 * import alpha programs.
 */
import {
  kalshiAccessHeaders,
  loadKalshiCredentials,
  type KalshiCredentials,
} from "./kalshi-auth.ts";
import type { KalshiFetchImpl } from "./kalshi-events-api.ts";
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";
import { mintSortableId } from "../lib/ids.ts";

export type KalshiOrderSide = "yes" | "no";

export type KalshiOrderRequest = {
  ticker: string;
  side: KalshiOrderSide;
  count: number;
  /** Limit price in cents (1–99). */
  priceCents: number;
  dryRun: boolean;
  /** Resting-maker entry — default true (maker-first doctrine). */
  postOnly?: boolean;
  /** Stable UUID v7 used by authorized execution to make provider retries idempotent. */
  clientOrderId?: string;
};

export type KalshiOrderResult = {
  orderId: string;
  clientOrderId: string;
  fillCount: number;
  remainingCount: number;
  averageFillPriceCents: number | null;
  averageFeePaidCents: number | null;
  processedAtMs: number | null;
  dryRun: boolean;
};

export type KalshiOrderLookupSource = "active" | "historical";
export type KalshiLifecycleFeed = "orders" | "fills";

export interface KalshiLifecyclePage {
  items: Record<string, unknown>[];
  cursor: string;
}

export type KalshiOrderLookupRecord = {
  orderId: string;
  clientOrderId: string;
  ticker: string;
  outcome: KalshiOrderSide;
  bookSide: "bid" | "ask";
  initialCount: number;
  fillCount: number | null;
  remainingCount: number | null;
  yesPriceCents: number;
  status: string | null;
};

/** Complete, bounded evidence from both current and archived order stores. */
export type KalshiOrderLookupResult =
  | { kind: "found"; source: KalshiOrderLookupSource; order: KalshiOrderLookupRecord }
  | { kind: "not_found"; pagesScanned: number }
  | { kind: "incomplete"; source: KalshiOrderLookupSource; pagesScanned: number }
  | { kind: "malformed"; source: KalshiOrderLookupSource; reason: string }
  | { kind: "provider_error"; source: KalshiOrderLookupSource; reason: string };

/** A provider response that proves the order was not accepted. */
export class KalshiRequestRejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly providerCode: string | null = null,
  ) {
    super(message);
    this.name = "KalshiRequestRejectedError";
  }
}

/** A transport/server result that cannot prove whether an order was accepted. */
export class KalshiRequestOutcomeUnknownError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "KalshiRequestOutcomeUnknownError";
  }
}

export class KalshiLifecyclePageMalformedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KalshiLifecyclePageMalformedError";
  }
}

export const KALSHI_REST_BASE = {
  demo: OFFICIAL_URLS.kalshi.tradeApiV2BaseDemo,
  prod: OFFICIAL_URLS.kalshi.tradeApiV2Base,
} as const;

export type KalshiEnvironment = keyof typeof KALSHI_REST_BASE;

/** Conservative default — Basic tier write budget ≈1 create/s sustained. */
export const DEFAULT_MIN_CREATE_SPACING_MS = 1_000;
export const DEFAULT_MAX_RETRIES = 3;

export type KalshiClientOptions = {
  env?: KalshiEnvironment;
  credentials?: KalshiCredentials;
  fetchImpl?: KalshiFetchImpl;
  /** Injectable sleep so tests never wait on the governor/backoff. */
  sleep?: (ms: number) => Promise<void>;
  minCreateSpacingMs?: number;
  maxRetries?: number;
};

export type KalshiClient = {
  environment: KalshiEnvironment;
  baseUrl: string;
  placeOrder(request: KalshiOrderRequest): Promise<KalshiOrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  getOrders(ticker?: string): Promise<Record<string, unknown>[]>;
  findOrderByClientOrderId(
    ticker: string,
    clientOrderId: string,
  ): Promise<Record<string, unknown> | null>;
  lookupOrderByClientOrderId(
    ticker: string,
    clientOrderId: string,
  ): Promise<KalshiOrderLookupResult>;
  getLifecyclePage(
    feed: KalshiLifecycleFeed,
    source: KalshiOrderLookupSource,
    cursor?: string,
    limit?: number,
  ): Promise<KalshiLifecyclePage>;
  getSettlementPage(cursor?: string, limit?: number): Promise<KalshiLifecyclePage>;
  getPositionsPage(cursor?: string, limit?: number): Promise<KalshiLifecyclePage>;
  getFills(ticker?: string): Promise<Record<string, unknown>[]>;
  getPositions(): Promise<Record<string, unknown>[]>;
  getBalance(): Promise<{ balanceCents: number | null }>;
};

/** Env gate — demo by default; prod must be explicitly armed. */
export function resolveKalshiEnvironment(
  env: Record<string, string | undefined> = Bun.env,
  explicit?: KalshiEnvironment,
): KalshiEnvironment {
  const name = explicit ?? (env.KALSHI_ENV === "prod" ? "prod" : "demo");
  if (name === "prod" && env.KALSHI_PROD_ARMED !== "1") {
    throw new Error(
      "Prod Kalshi client blocked — set KALSHI_PROD_ARMED=1 after demo reconciliation passes (G4)",
    );
  }
  return name;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fixedCount(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : 0;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function optionalFixedCount(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(Math.trunc(parsed)) && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : null;
}

function fixedDollarsToCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function fixedDollarsToExactCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(value));
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(4, "0"));
  const tenThousandths = whole * 10_000 + fraction;
  if (!Number.isSafeInteger(tenThousandths)) return null;
  const cents = tenThousandths / 100;
  return cents >= 0 && cents <= 100 ? cents : null;
}

function parseKalshiErrorDetail(text: string): { code: string | null; message: string } {
  const fallback = text.trim().slice(0, 200);
  if (!fallback) return { code: null, message: "" };
  try {
    const parsed: unknown = JSON.parse(text);
    const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : parsed;
    if (!isRecord(envelope)) return { code: null, message: fallback };
    const code = typeof envelope.code === "string" ? envelope.code.slice(0, 80) : null;
    const message =
      typeof envelope.message === "string" ? envelope.message.slice(0, 200) : fallback;
    return { code, message };
  } catch {
    return { code: null, message: fallback };
  }
}

/** Exponential backoff with jitter — 429s carry no Retry-After. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  return Math.min(10_000, 500 * 2 ** attempt) + Math.floor(random() * 250);
}

/** Default sleep — native timer, no setTimeout wrapper. @see https://bun.com/docs/api/utils#bunsleep */
function defaultSleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}

export function createKalshiClient(options: KalshiClientOptions = {}): KalshiClient {
  const environment = resolveKalshiEnvironment(
    Bun.env,
    options.env,
  );
  const baseUrl = KALSHI_REST_BASE[environment];
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const minCreateSpacingMs = options.minCreateSpacingMs ?? DEFAULT_MIN_CREATE_SPACING_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  let creds: KalshiCredentials | null = options.credentials ?? null;
  let lastCreateMs = 0;

  async function credentials(): Promise<KalshiCredentials> {
    creds ??= await loadKalshiCredentials();
    return creds;
  }

  async function signedRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      // Kalshi signs the FULL request path (host excluded) - e.g.
      // /trade-api/v2/portfolio/balance, NOT /portfolio/balance. Signing the
      // endpoint path alone yields 401 authentication_error even with valid
      // creds (probed 2026-08-24). kalshiWsAccessHeaders already signs the
      // full pathname; this REST path did not.
      ...kalshiAccessHeaders(await credentials(), method, new URL(baseUrl + path).pathname),
    };
    if (body) headers["Content-Type"] = "application/json";
    // Create retries reuse the same client_order_id (idempotency key) and only
    // happen when no order id was returned — 429/5xx arrived before placement.
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        const text = await res.text().catch(() => "");
        const detail = parseKalshiErrorDetail(text);
        const message = `Kalshi ${method} ${path}: ${res.status} ${res.statusText}${detail.message ? ` — ${detail.message}` : ""}`;
        if (res.status >= 400 && res.status < 500) {
          throw new KalshiRequestRejectedError(message, res.status, detail.code);
        }
        throw new KalshiRequestOutcomeUnknownError(message, res.status);
      }
      await sleep(backoffMs(attempt));
    }
    throw new Error("unreachable");
  }

  async function governCreate(): Promise<void> {
    const wait = minCreateSpacingMs - (Date.now() - lastCreateMs);
    if (wait > 0) await sleep(wait);
    lastCreateMs = Date.now();
  }

  async function placeOrder(request: KalshiOrderRequest): Promise<KalshiOrderResult> {
    if (request.dryRun) {
      return {
        orderId: `dry-${request.ticker}-${Date.now()}`,
        clientOrderId: request.clientOrderId ?? mintSortableId(),
        fillCount: 0,
        remainingCount: request.count,
        averageFillPriceCents: null,
        averageFeePaidCents: null,
        processedAtMs: null,
        dryRun: true,
      };
    }
    if (request.count < 1 || request.priceCents < 1 || request.priceCents > 99) {
      throw new Error(
        `Invalid order: count=${request.count} priceCents=${request.priceCents} (count ≥1, price 1–99)`,
      );
    }
    await governCreate();
    const clientOrderId = request.clientOrderId ?? mintSortableId();
    const yesPriceCents = request.side === "yes" ? request.priceCents : 100 - request.priceCents;
    const body: Record<string, unknown> = {
      ticker: request.ticker,
      side: request.side === "yes" ? "bid" : "ask",
      count: `${request.count}.00`,
      price: (yesPriceCents / 100).toFixed(4),
      client_order_id: clientOrderId,
      time_in_force: "good_till_canceled",
      post_only: request.postOnly ?? true,
      cancel_order_on_pause: true,
      self_trade_prevention_type: "taker_at_cross",
      subaccount: 0,
    };
    const res = await signedRequest("POST", "/portfolio/events/orders", body);
    const orderId = isRecord(res) && typeof res.order_id === "string" ? res.order_id : null;
    if (!orderId) {
      throw new KalshiRequestOutcomeUnknownError(
        `Kalshi order create: missing order_id in response for ${request.ticker}`,
      );
    }
    return {
      orderId,
      clientOrderId:
        isRecord(res) && typeof res.client_order_id === "string"
          ? res.client_order_id
          : clientOrderId,
      fillCount: fixedCount(isRecord(res) ? res.fill_count : null),
      remainingCount: fixedCount(isRecord(res) ? res.remaining_count : null),
      averageFillPriceCents: fixedDollarsToCents(
        isRecord(res) ? res.average_fill_price : null,
      ),
      averageFeePaidCents: fixedDollarsToCents(
        isRecord(res) ? res.average_fee_paid : null,
      ),
      processedAtMs:
        isRecord(res) && Number.isSafeInteger(res.ts_ms) ? (res.ts_ms as number) : null,
      dryRun: false,
    };
  }

  async function cancelOrder(orderId: string): Promise<void> {
    await signedRequest(
      "DELETE",
      `/portfolio/events/orders/${encodeURIComponent(orderId)}?subaccount=0`,
    );
  }

  async function listPath(path: string, key: string): Promise<Record<string, unknown>[]> {
    const res = await signedRequest("GET", path);
    if (!isRecord(res) || !Array.isArray(res[key])) return [];
    return res[key].filter(isRecord);
  }

  async function findOrderByClientOrderId(
    ticker: string,
    clientOrderId: string,
  ): Promise<Record<string, unknown> | null> {
    const result = await lookupOrderByClientOrderId(ticker, clientOrderId);
    if (result.kind === "not_found") return null;
    if (result.kind === "found") return lookupRecordToWire(result.order);
    const detail =
      result.kind === "provider_error" || result.kind === "malformed"
        ? result.reason
        : "bounded pagination exhausted";
    throw new KalshiRequestOutcomeUnknownError(
      `Kalshi order lookup ${result.kind}: ${detail}`,
    );
  }

  async function lookupOrderByClientOrderId(
    ticker: string,
    clientOrderId: string,
  ): Promise<KalshiOrderLookupResult> {
    let pagesScanned = 0;
    const inconclusive: Array<
      Exclude<KalshiOrderLookupResult, { kind: "found" | "not_found" }>
    > = [];
    for (const source of ["active", "historical"] as const) {
      const path = source === "active" ? "/portfolio/orders" : "/historical/orders";
      let cursor = "";
      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({ ticker, limit: "1000" });
        if (source === "active") query.set("subaccount", "0");
        if (cursor) query.set("cursor", cursor);
        let response: unknown;
        try {
          response = await signedRequest("GET", `${path}?${query}`);
        } catch (error) {
          inconclusive.push({
            kind: "provider_error",
            source,
            reason: sanitizeLookupError(error),
          });
          break;
        }
        pagesScanned++;
        if (!isRecord(response) || !Array.isArray(response.orders)) {
          inconclusive.push({
            kind: "malformed",
            source,
            reason: "order list envelope is invalid",
          });
          break;
        }
        let matches: Record<string, unknown>[];
        try {
          matches = response.orders
            .filter(isRecord)
            .filter((order) => source === "active" || isPrimaryHistoricalRecord(order, "order"))
            .filter((order) => order.client_order_id === clientOrderId);
        } catch (error) {
          return { kind: "malformed", source, reason: sanitizeLookupError(error) };
        }
        if (matches.length > 1) {
          return { kind: "malformed", source, reason: "duplicate client order ID" };
        }
        if (matches.length === 1) {
          const parsed = parseLookupOrder(matches[0]!);
          return parsed.ok
            ? { kind: "found", source, order: parsed.order }
            : { kind: "malformed", source, reason: parsed.reason };
        }
        const nextCursor = response.cursor;
        if (nextCursor !== undefined && typeof nextCursor !== "string") {
          inconclusive.push({ kind: "malformed", source, reason: "pagination cursor is invalid" });
          break;
        }
        cursor = typeof nextCursor === "string" ? nextCursor : "";
        if (!cursor) break;
        if (page === 9) inconclusive.push({ kind: "incomplete", source, pagesScanned });
      }
    }
    const providerError = inconclusive.find((result) => result.kind === "provider_error");
    if (providerError) return providerError;
    const malformed = inconclusive.find((result) => result.kind === "malformed");
    if (malformed) return malformed;
    const incomplete = inconclusive.find((result) => result.kind === "incomplete");
    if (incomplete) return incomplete;
    return { kind: "not_found", pagesScanned };
  }

  async function getLifecyclePage(
    feed: KalshiLifecycleFeed,
    source: KalshiOrderLookupSource,
    cursor = "",
    limit = 1_000,
  ): Promise<KalshiLifecyclePage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError("Kalshi lifecycle page limit must be from 1 to 1000");
    }
    const prefix = source === "active" ? "/portfolio" : "/historical";
    const query = new URLSearchParams({ limit: String(limit) });
    if (source === "active") query.set("subaccount", "0");
    if (cursor) query.set("cursor", cursor);
    const response = await signedRequest("GET", `${prefix}/${feed}?${query}`);
    if (!isRecord(response) || !Array.isArray(response[feed])) {
      throw new KalshiLifecyclePageMalformedError(`Kalshi ${source} ${feed} page is malformed`);
    }
    if (response.cursor !== undefined && typeof response.cursor !== "string") {
      throw new KalshiLifecyclePageMalformedError(`Kalshi ${source} ${feed} cursor is malformed`);
    }
    return {
      items: response[feed]
        .filter(isRecord)
        .filter((item) => source === "active" || isPrimaryHistoricalRecord(item, feed.slice(0, -1))),
      cursor: typeof response.cursor === "string" ? response.cursor : "",
    };
  }

  async function getSettlementPage(cursor = "", limit = 1_000): Promise<KalshiLifecyclePage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError("Kalshi settlement page limit must be from 1 to 1000");
    }
    const query = new URLSearchParams({ limit: String(limit), subaccount: "0" });
    if (cursor) query.set("cursor", cursor);
    const response = await signedRequest("GET", `/portfolio/settlements?${query}`);
    if (!isRecord(response) || !Array.isArray(response.settlements)) {
      throw new KalshiLifecyclePageMalformedError("Kalshi settlement page is malformed");
    }
    if (response.cursor !== undefined && typeof response.cursor !== "string") {
      throw new KalshiLifecyclePageMalformedError("Kalshi settlement cursor is malformed");
    }
    return {
      items: response.settlements.filter(isRecord),
      cursor: typeof response.cursor === "string" ? response.cursor : "",
    };
  }

  async function getPositionsPage(cursor = "", limit = 1_000): Promise<KalshiLifecyclePage> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new TypeError("Kalshi positions page limit must be from 1 to 1000");
    }
    const query = new URLSearchParams({ limit: String(limit), subaccount: "0" });
    if (cursor) query.set("cursor", cursor);
    const response = await signedRequest("GET", `/portfolio/positions?${query}`);
    if (!isRecord(response) || !Array.isArray(response.market_positions)) {
      throw new KalshiLifecyclePageMalformedError("Kalshi positions page is malformed");
    }
    if (response.cursor !== undefined && typeof response.cursor !== "string") {
      throw new KalshiLifecyclePageMalformedError("Kalshi positions cursor is malformed");
    }
    return {
      items: response.market_positions.filter(isRecord),
      cursor: typeof response.cursor === "string" ? response.cursor : "",
    };
  }

  return {
    environment,
    baseUrl,
    placeOrder,
    cancelOrder,
    getOrders: (ticker?: string) => listPath(
      `/portfolio/orders?${new URLSearchParams({ ...(ticker ? { ticker } : {}), subaccount: "0" })}`,
      "orders",
    ),
    findOrderByClientOrderId,
    lookupOrderByClientOrderId,
    getLifecyclePage,
    getSettlementPage,
    getPositionsPage,
    getFills: (ticker?: string) => listPath(
      `/portfolio/fills?${new URLSearchParams({ ...(ticker ? { ticker } : {}), subaccount: "0" })}`,
      "fills",
    ),
    getPositions: () => listPath("/portfolio/positions?subaccount=0", "market_positions"),
    getBalance: async () => {
      const res = await signedRequest("GET", "/portfolio/balance?subaccount=0");
      return {
        balanceCents:
          isRecord(res) && typeof res.balance === "number" ? res.balance : null,
      };
    },
  };
}

function isPrimaryHistoricalRecord(
  wire: Record<string, unknown>,
  label: string,
): boolean {
  const value = wire.subaccount_number ?? wire.subaccount;
  if (value === 0) return true;
  if (Number.isSafeInteger(value) && Number(value) > 0) return false;
  throw new KalshiLifecyclePageMalformedError(`Kalshi historical ${label} subaccount is malformed`);
}

function parseLookupOrder(
  order: Record<string, unknown>,
): { ok: true; order: KalshiOrderLookupRecord } | { ok: false; reason: string } {
  const orderId = requiredLookupString(order.order_id);
  const clientOrderId = requiredLookupString(order.client_order_id);
  const ticker = requiredLookupString(order.ticker);
  const outcomeValue = order.outcome_side ?? order.side;
  const outcome = outcomeValue === "yes" || outcomeValue === "no" ? outcomeValue : null;
  const bookSideValue = order.book_side;
  const bookSide = bookSideValue === "bid" || bookSideValue === "ask" ? bookSideValue : null;
  const initialCount = optionalFixedCount(order.initial_count_fp ?? order.initial_count);
  const yesPriceCents =
    fixedDollarsToExactCents(order.yes_price_dollars) ?? optionalFixedCount(order.yes_price);
  if (
    !orderId ||
    !clientOrderId ||
    !ticker ||
    !outcome ||
    !bookSide ||
    initialCount === null ||
    yesPriceCents === null ||
    yesPriceCents > 100
  ) {
    return { ok: false, reason: "matched order is missing required identity or term fields" };
  }
  return {
    ok: true,
    order: {
      orderId,
      clientOrderId,
      ticker,
      outcome,
      bookSide,
      initialCount,
      fillCount: optionalFixedCount(order.fill_count_fp ?? order.fill_count),
      remainingCount: optionalFixedCount(order.remaining_count_fp ?? order.remaining_count),
      yesPriceCents,
      status: requiredLookupString(order.status),
    },
  };
}

function lookupRecordToWire(order: KalshiOrderLookupRecord): Record<string, unknown> {
  return {
    order_id: order.orderId,
    client_order_id: order.clientOrderId,
    ticker: order.ticker,
    outcome_side: order.outcome,
    book_side: order.bookSide,
    initial_count_fp: order.initialCount.toFixed(2),
    fill_count_fp: order.fillCount?.toFixed(2),
    remaining_count_fp: order.remainingCount?.toFixed(2),
    yes_price_dollars: (order.yesPriceCents / 100).toFixed(4),
    status: order.status,
  };
}

function requiredLookupString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

function sanitizeLookupError(error: unknown): string {
  const message = error instanceof Error ? error.message : "provider lookup failed";
  return message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240) || "provider lookup failed";
}

let defaultClient: KalshiClient | null = null;

export function getDefaultKalshiClient(): KalshiClient {
  defaultClient ??= createKalshiClient();
  return defaultClient;
}

/**
 * Module-level entry — preserves the original stub signature.
 * dryRun is unchanged (fake id, no env/network); live delegates to the
 * env-configured default client.
 */
export async function placeOrder(request: KalshiOrderRequest): Promise<KalshiOrderResult> {
  if (request.dryRun) {
    return {
      orderId: `dry-${request.ticker}-${Date.now()}`,
      clientOrderId: request.clientOrderId ?? mintSortableId(),
      fillCount: 0,
      remainingCount: request.count,
      averageFillPriceCents: null,
      averageFeePaidCents: null,
      processedAtMs: null,
      dryRun: true,
    };
  }
  return getDefaultKalshiClient().placeOrder(request);
}

export async function cancelOrder(orderId: string): Promise<void> {
  return getDefaultKalshiClient().cancelOrder(orderId);
}

export async function getOrders(ticker?: string): Promise<Record<string, unknown>[]> {
  return getDefaultKalshiClient().getOrders(ticker);
}

export async function getFills(ticker?: string): Promise<Record<string, unknown>[]> {
  return getDefaultKalshiClient().getFills(ticker);
}

export async function getPositions(): Promise<Record<string, unknown>[]> {
  return getDefaultKalshiClient().getPositions();
}

export async function getBalance(): Promise<{ balanceCents: number | null }> {
  return getDefaultKalshiClient().getBalance();
}
