// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  backoffMs,
  createKalshiClient,
  KalshiRequestOutcomeUnknownError,
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
    // Hermetic: local .env may set KALSHI_ENV=prod + PROD_ARMED — force demo.
    env: "demo",
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
  return new Response(JSON.stringify({
    order_id: orderId,
    client_order_id: "provider-client-id",
    fill_count: "2.00",
    remaining_count: "3.00",
    average_fill_price: "0.4200",
    average_fee_paid: "0.0100",
    ts_ms: 1_700_000_000_000,
  }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

const ORDER = { ticker: "KXATPMATCH-26JUL22BORBUR-BUR", side: "yes" as const, count: 5, priceCents: 42 };

describe("kalshi-client environment", () => {
  test("defaults to demo base URL", () => {
    expect(resolveKalshiEnvironment({})).toBe("demo");
    expect(KALSHI_REST_BASE.demo).toBe("https://external-api.demo.kalshi.co/trade-api/v2");
    expect(KALSHI_REST_BASE.prod).toBe("https://api.elections.kalshi.com/trade-api/v2");
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
    expect(result).toEqual({
      orderId: "order-123",
      clientOrderId: "provider-client-id",
      fillCount: 2,
      remainingCount: 3,
      averageFillPriceCents: 42,
      averageFeePaidCents: 1,
      processedAtMs: 1_700_000_000_000,
      dryRun: false,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${KALSHI_REST_BASE.demo}/portfolio/events/orders`);
    expect(call.method).toBe("POST");
    expect(call.headers["KALSHI-ACCESS-KEY"]).toBe("test-key-id");
    expect(call.headers["KALSHI-ACCESS-TIMESTAMP"]).toMatch(/^\d+$/);
    expect(call.headers["KALSHI-ACCESS-SIGNATURE"]?.length).toBeGreaterThan(80);

    const body = call.body as Record<string, unknown>;
    expect(body.ticker).toBe(ORDER.ticker);
    expect(body.side).toBe("bid");
    expect(body.count).toBe("5.00");
    expect(body.price).toBe("0.4200");
    expect(typeof body.client_order_id).toBe("string");
    expect(body.time_in_force).toBe("good_till_canceled");
    expect(body.post_only).toBe(true);
    expect(body.cancel_order_on_pause).toBe(true);
    expect(body.self_trade_prevention_type).toBe("taker_at_cross");
  });

  test("NO buys map to an ask on the V2 YES-denominated book", async () => {
    const { client, calls } = makeClient({ responses: [okOrder()] });
    await client.placeOrder({ ...ORDER, side: "no", dryRun: false, postOnly: false });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.side).toBe("ask");
    expect(body.price).toBe("0.5800");
    expect(body.post_only).toBe(false);
  });

  test("forwards an explicit execution idempotency UUID", async () => {
    const { client, calls } = makeClient({ responses: [okOrder()] });
    const clientOrderId = "f47ac10b-58cc-5372-a567-0e02b2c3d479";
    await client.placeOrder({ ...ORDER, dryRun: false, clientOrderId });
    expect((calls[0]!.body as Record<string, unknown>).client_order_id).toBe(clientOrderId);
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

  test("a successful but unidentifiable create response is outcome-unknown", async () => {
    const { client } = makeClient({
      responses: [new Response(JSON.stringify({ fill_count: "1.00" }), { status: 201 })],
    });
    await expect(client.placeOrder({ ...ORDER, dryRun: false })).rejects.toBeInstanceOf(
      KalshiRequestOutcomeUnknownError,
    );
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

describe("kalshi-client order reconciliation lookup", () => {
  test("paginates ticker orders until the deterministic client order ID is found", async () => {
    const { client, calls } = makeClient({
      responses: [
        new Response(JSON.stringify({
          orders: [{ order_id: "other", client_order_id: "other-key" }],
          cursor: "next page",
        })),
        new Response(JSON.stringify({
          orders: [{
            order_id: "order-123",
            client_order_id: "wanted-key",
            ticker: ORDER.ticker,
            outcome_side: "yes",
            book_side: "bid",
            initial_count_fp: "5.00",
            fill_count_fp: "1.00",
            remaining_count_fp: "4.00",
            yes_price_dollars: "0.4200",
          }],
          cursor: "",
        })),
      ],
    });

    expect(await client.findOrderByClientOrderId(ORDER.ticker, "wanted-key")).toMatchObject({
      order_id: "order-123",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain(`ticker=${encodeURIComponent(ORDER.ticker)}`);
    expect(calls[0]!.url).toContain("limit=1000");
    expect(calls[1]!.url).toContain("cursor=next+page");
  });

  test("returns null only after exhausting a complete cursor chain", async () => {
    const { client } = makeClient({
      responses: [
        new Response(JSON.stringify({ orders: [], cursor: "" })),
        new Response(JSON.stringify({ orders: [], cursor: "" })),
      ],
    });
    expect(await client.findOrderByClientOrderId(ORDER.ticker, "missing")).toBeNull();
  });

  test("searches historical orders after a complete active miss", async () => {
    const { client, calls } = makeClient({
      responses: [
        new Response(JSON.stringify({ orders: [], cursor: "" })),
        new Response(JSON.stringify({
          orders: [{
            order_id: "archived-1",
            client_order_id: "archived-key",
            ticker: ORDER.ticker,
            outcome_side: "no",
            book_side: "ask",
            initial_count_fp: "3.00",
            fill_count_fp: "3.00",
            remaining_count_fp: "0.00",
            yes_price_dollars: "0.6000",
            status: "executed",
          }],
          cursor: "",
        })),
      ],
    });
    const result = await client.lookupOrderByClientOrderId(ORDER.ticker, "archived-key");
    expect(result).toMatchObject({
      kind: "found",
      source: "historical",
      order: { outcome: "no", bookSide: "ask", initialCount: 3, yesPriceCents: 60 },
    });
    expect(calls[1]!.url).toContain("/historical/orders?");
  });

  test("accepts exact historical evidence even when the active feed fails", async () => {
    const { client } = makeClient({
      responses: [
        new Response("active unavailable", { status: 503 }),
        new Response(JSON.stringify({
          orders: [{
            order_id: "archived-after-error",
            client_order_id: "historical-key",
            ticker: ORDER.ticker,
            outcome_side: "yes",
            book_side: "bid",
            initial_count_fp: "5.00",
            fill_count_fp: "5.00",
            remaining_count_fp: "0.00",
            yes_price_dollars: "0.4200",
          }],
          cursor: "",
        })),
      ],
      options: { maxRetries: 0 },
    });
    expect(await client.lookupOrderByClientOrderId(ORDER.ticker, "historical-key"))
      .toMatchObject({ kind: "found", source: "historical" });
  });

  test("distinguishes malformed and provider-error lookup evidence", async () => {
    const malformed = makeClient({
      responses: [
        new Response(JSON.stringify({ orders: "bad", cursor: "" })),
        new Response(JSON.stringify({ orders: [], cursor: "" })),
      ],
    }).client;
    expect(await malformed.lookupOrderByClientOrderId(ORDER.ticker, "key")).toMatchObject({
      kind: "malformed",
      source: "active",
    });
    const failed = makeClient({
      responses: [
        new Response("unavailable", { status: 503 }),
        new Response(JSON.stringify({ orders: [], cursor: "" })),
      ],
      options: { maxRetries: 0 },
    }).client;
    expect(await failed.lookupOrderByClientOrderId(ORDER.ticker, "key")).toMatchObject({
      kind: "provider_error",
      source: "active",
    });
  });

  test("does not promote a matching ID with incomplete terms", async () => {
    const { client } = makeClient({
      responses: [new Response(JSON.stringify({
        orders: [{
          order_id: "incomplete-order",
          client_order_id: "incomplete-key",
          ticker: ORDER.ticker,
        }],
        cursor: "",
      }))],
    });
    expect(await client.lookupOrderByClientOrderId(ORDER.ticker, "incomplete-key"))
      .toMatchObject({
        kind: "malformed",
        source: "active",
        reason: "matched order is missing required identity or term fields",
      });
  });

  test("reports incomplete evidence when a bounded feed still has a cursor", async () => {
    const activePages = Array.from({ length: 10 }, (_, index) =>
      new Response(JSON.stringify({ orders: [], cursor: `active-${index + 1}` })),
    );
    const { client } = makeClient({
      responses: [
        ...activePages,
        new Response(JSON.stringify({ orders: [], cursor: "" })),
      ],
    });
    expect(await client.lookupOrderByClientOrderId(ORDER.ticker, "key")).toMatchObject({
      kind: "incomplete",
      source: "active",
      pagesScanned: 10,
    });
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
