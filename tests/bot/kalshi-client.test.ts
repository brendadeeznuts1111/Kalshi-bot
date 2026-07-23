// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  backoffMs,
  createKalshiClient,
  KALSHI_REST_BASE,
  placeOrder,
  resolveKalshiEnvironment,
  type KalshiClientOptions,
} from "../../src/bot/kalshi-client.ts";
import type { KalshiCredentials } from "../../src/bot/kalshi-auth.ts";
import type { KalshiFetchImpl } from "../../src/bot/kalshi-events-api.ts";

type CapturedCall = { url: string; method: string; headers: Record<string, string>; body: unknown };

function makeClient(overrides: {
  responses: Response[];
  options?: Partial<KalshiClientOptions>;
}) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credentials: KalshiCredentials = { keyId: "test-key-id", privateKey };
  const calls: CapturedCall[] = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchImpl: KalshiFetchImpl = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    const res = overrides.responses[Math.min(i, overrides.responses.length - 1)];
    i++;
    return res;
  };
  const client = createKalshiClient({
    credentials,
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    minCreateSpacingMs: 0,
    ...overrides.options,
  });
  return { client, calls, sleeps };
}

function okOrder(orderId = "order-123"): Response {
  return new Response(JSON.stringify({ order: { order_id: orderId, status: "resting" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const ORDER = { ticker: "KXATPMATCH-26JUL22BORBUR-BUR", side: "yes" as const, count: 5, priceCents: 42 };

describe("kalshi-client environment", () => {
  test("defaults to demo base URL", () => {
    expect(resolveKalshiEnvironment({})).toBe("demo");
    expect(KALSHI_REST_BASE.demo).toBe("https://external-api.demo.kalshi.co/trade-api/v2");
    expect(KALSHI_REST_BASE.prod).toBe("https://external-api.kalshi.com/trade-api/v2");
  });

  test("prod requires KALSHI_PROD_ARMED=1", () => {
    expect(() => resolveKalshiEnvironment({}, "prod")).toThrow(/KALSHI_PROD_ARMED/);
    expect(resolveKalshiEnvironment({ KALSHI_PROD_ARMED: "1" }, "prod")).toBe("prod");
    expect(() => resolveKalshiEnvironment({ KALSHI_ENV: "prod" })).toThrow(/KALSHI_PROD_ARMED/);
  });
});

describe("kalshi-client placeOrder", () => {
  test("signs request and posts maker-first body to demo", async () => {
    const { client, calls } = makeClient({ responses: [okOrder()] });
    const result = await client.placeOrder({ ...ORDER, dryRun: false });
    expect(result).toEqual({ orderId: "order-123", dryRun: false });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${KALSHI_REST_BASE.demo}/portfolio/orders`);
    expect(call.method).toBe("POST");
    expect(call.headers["KALSHI-ACCESS-KEY"]).toBe("test-key-id");
    expect(call.headers["KALSHI-ACCESS-TIMESTAMP"]).toMatch(/^\d+$/);
    expect(call.headers["KALSHI-ACCESS-SIGNATURE"]?.length).toBeGreaterThan(80);

    const body = call.body as Record<string, unknown>;
    expect(body.ticker).toBe(ORDER.ticker);
    expect(body.side).toBe("yes");
    expect(body.action).toBe("buy");
    expect(body.count).toBe(5);
    expect(body.yes_price).toBe(42);
    expect(body.no_price).toBeUndefined();
    expect(typeof body.client_order_id).toBe("string");
    expect(body.time_in_force).toBe("good_till_canceled");
    expect(body.post_only).toBe(true);
    expect(body.cancel_order_on_pause).toBe(true);
    expect(body.self_trade_prevention_type).toBe("taker_at_cross");
  });

  test("no-side orders quote no_price; post_only caller-overridable", async () => {
    const { client, calls } = makeClient({ responses: [okOrder()] });
    await client.placeOrder({ ...ORDER, side: "no", dryRun: false, postOnly: false });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.no_price).toBe(42);
    expect(body.yes_price).toBeUndefined();
    expect(body.post_only).toBe(false);
  });

  test("429 backs off and retries with the same request", async () => {
    const { client, calls, sleeps } = makeClient({
      responses: [new Response("rate limited", { status: 429 }), okOrder("order-after-retry")],
    });
    const result = await client.placeOrder({ ...ORDER, dryRun: false });
    expect(result.orderId).toBe("order-after-retry");
    expect(calls).toHaveLength(2);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    const first = calls[0]!.body as Record<string, unknown>;
    const second = calls[1]!.body as Record<string, unknown>;
    expect(second.client_order_id).toBe(first.client_order_id);
  });

  test("non-retryable 4xx throws with status", async () => {
    const { client, calls } = makeClient({
      responses: [new Response("bad ticker", { status: 400 })],
    });
    await expect(client.placeOrder({ ...ORDER, dryRun: false })).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
  });

  test("dryRun never touches fetch or env", async () => {
    const { client, calls } = makeClient({ responses: [] });
    const viaClient = await client.placeOrder({ ...ORDER, dryRun: true });
    expect(viaClient.dryRun).toBe(true);
    expect(viaClient.orderId).toMatch(/^dry-KXATPMATCH/);
    const viaModule = await placeOrder({ ...ORDER, dryRun: true });
    expect(viaModule.dryRun).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("kalshi-client portfolio reads", () => {
  test("cancelOrder signs DELETE on the order path", async () => {
    const { client, calls } = makeClient({
      responses: [new Response("{}", { status: 200 })],
    });
    await client.cancelOrder("order-123");
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe(`${KALSHI_REST_BASE.demo}/portfolio/orders/order-123`);
    expect(calls[0]!.headers["KALSHI-ACCESS-KEY"]).toBe("test-key-id");
  });

  test("getOrders/getFills pass ticker filter; balance parses cents", async () => {
    const { client, calls } = makeClient({
      responses: [
        new Response(JSON.stringify({ orders: [{ order_id: "o1" }] }), { status: 200 }),
        new Response(JSON.stringify({ fills: [{ fill_id: "f1" }] }), { status: 200 }),
        new Response(JSON.stringify({ balance: 12_345 }), { status: 200 }),
      ],
    });
    const orders = await client.getOrders("KXATPMATCH-26JUL22BORBUR-BUR");
    expect(orders).toHaveLength(1);
    expect(calls[0]!.url).toContain("/portfolio/orders?ticker=KXATPMATCH");
    const fills = await client.getFills("KXATPMATCH-26JUL22BORBUR-BUR");
    expect(fills).toHaveLength(1);
    expect(calls[1]!.url).toContain("/portfolio/fills?ticker=");
    const balance = await client.getBalance();
    expect(balance.balanceCents).toBe(12_345);
  });

  test("backoff grows exponentially and stays capped", () => {
    expect(backoffMs(0, () => 0)).toBe(500);
    expect(backoffMs(1, () => 0)).toBe(1_000);
    expect(backoffMs(2, () => 0)).toBe(2_000);
    expect(backoffMs(10, () => 0.999)).toBeLessThanOrEqual(10_249);
  });
});
