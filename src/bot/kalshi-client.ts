// @see https://docs.kalshi.com/api-reference/order/create-order
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
};

export type KalshiOrderResult = {
  orderId: string;
  dryRun: boolean;
};

export const KALSHI_REST_BASE = {
  demo: "https://external-api.demo.kalshi.co/trade-api/v2",
  prod: "https://external-api.kalshi.com/trade-api/v2",
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
  getFills(ticker?: string): Promise<Record<string, unknown>[]>;
  getPositions(): Promise<Record<string, unknown>[]>;
  getBalance(): Promise<{ balanceCents: number | null }>;
};

/** Env gate — demo by default; prod must be explicitly armed. */
export function resolveKalshiEnvironment(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
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

/** Exponential backoff with jitter — 429s carry no Retry-After. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  return Math.min(10_000, 500 * 2 ** attempt) + Math.floor(random() * 250);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createKalshiClient(options: KalshiClientOptions = {}): KalshiClient {
  const environment = resolveKalshiEnvironment(
    Bun.env as Record<string, string | undefined>,
    options.env,
  );
  const baseUrl = KALSHI_REST_BASE[environment];
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const minCreateSpacingMs = options.minCreateSpacingMs ?? DEFAULT_MIN_CREATE_SPACING_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  let creds: KalshiCredentials | null = options.credentials ?? null;
  let lastCreateMs = 0;

  function credentials(): KalshiCredentials {
    creds ??= loadKalshiCredentials();
    return creds;
  }

  async function signedRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...kalshiAccessHeaders(credentials(), method, path),
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
        throw new Error(
          `Kalshi ${method} ${path}: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
        );
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
      return { orderId: `dry-${request.ticker}-${Date.now()}`, dryRun: true };
    }
    if (request.count < 1 || request.priceCents < 1 || request.priceCents > 99) {
      throw new Error(
        `Invalid order: count=${request.count} priceCents=${request.priceCents} (count ≥1, price 1–99)`,
      );
    }
    await governCreate();
    const body: Record<string, unknown> = {
      ticker: request.ticker,
      side: request.side,
      action: "buy",
      count: request.count,
      client_order_id: crypto.randomUUID(),
      time_in_force: "good_till_canceled",
      post_only: request.postOnly ?? true,
      cancel_order_on_pause: true,
      self_trade_prevention_type: "taker_at_cross",
    };
    // Price field matches the quoted side (yes_price for YES, no_price for NO).
    body[request.side === "yes" ? "yes_price" : "no_price"] = request.priceCents;
    const res = await signedRequest("POST", "/portfolio/orders", body);
    const orderId =
      isRecord(res) && isRecord(res.order) && typeof res.order.order_id === "string"
        ? res.order.order_id
        : null;
    if (!orderId) {
      throw new Error(`Kalshi order create: missing order_id in response for ${request.ticker}`);
    }
    return { orderId, dryRun: false };
  }

  async function cancelOrder(orderId: string): Promise<void> {
    await signedRequest("DELETE", `/portfolio/orders/${encodeURIComponent(orderId)}`);
  }

  async function listPath(path: string, key: string): Promise<Record<string, unknown>[]> {
    const res = await signedRequest("GET", path);
    if (!isRecord(res) || !Array.isArray(res[key])) return [];
    return res[key].filter(isRecord);
  }

  return {
    environment,
    baseUrl,
    placeOrder,
    cancelOrder,
    getOrders: (ticker?: string) =>
      listPath(`/portfolio/orders${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`, "orders"),
    getFills: (ticker?: string) =>
      listPath(`/portfolio/fills${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`, "fills"),
    getPositions: () => listPath("/portfolio/positions", "market_positions"),
    getBalance: async () => {
      const res = await signedRequest("GET", "/portfolio/balance");
      return {
        balanceCents:
          isRecord(res) && typeof res.balance === "number" ? res.balance : null,
      };
    },
  };
}

let defaultClient: KalshiClient | null = null;

function getDefaultClient(): KalshiClient {
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
    return { orderId: `dry-${request.ticker}-${Date.now()}`, dryRun: true };
  }
  return getDefaultClient().placeOrder(request);
}

export async function cancelOrder(orderId: string): Promise<void> {
  return getDefaultClient().cancelOrder(orderId);
}

export async function getOrders(ticker?: string): Promise<Record<string, unknown>[]> {
  return getDefaultClient().getOrders(ticker);
}

export async function getFills(ticker?: string): Promise<Record<string, unknown>[]> {
  return getDefaultClient().getFills(ticker);
}

export async function getPositions(): Promise<Record<string, unknown>[]> {
  return getDefaultClient().getPositions();
}

export async function getBalance(): Promise<{ balanceCents: number | null }> {
  return getDefaultClient().getBalance();
}
