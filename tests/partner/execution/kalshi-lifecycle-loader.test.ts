import { describe, expect, test } from "bun:test";
import type { KalshiClient, KalshiLifecyclePage } from "../../../src/bot/kalshi-client.ts";
import {
  loadKalshiLifecycleBatch,
  normalizeKalshiLifecycleFill,
  normalizeKalshiLifecycleOrder,
} from "../../../src/partner/execution/kalshi-lifecycle-loader.ts";

describe("Kalshi cursor-complete lifecycle loader", () => {
  test("reads all four account feeds, follows cursors, normalizes, and deduplicates", async () => {
    const calls: string[] = [];
    const client = mockClient((feed, source, cursor) => {
      calls.push(`${source}:${feed}:${cursor || "first"}`);
      if (feed === "orders" && source === "active" && !cursor) {
        return { items: [], cursor: "orders-next" };
      }
      if (feed === "orders" && source === "active") {
        return { items: [orderWire()], cursor: "" };
      }
      if (feed === "fills" && source === "active") {
        return { items: [fillWire()], cursor: "" };
      }
      if (feed === "fills" && source === "historical") {
        return { items: [fillWire()], cursor: "" };
      }
      return { items: [], cursor: "" };
    });
    const result = await loadKalshiLifecycleBatch(client, {
      outId: "out-SPORTS-1",
      observedAtMs: 1_700_000_000_000,
    });
    expect(result).toMatchObject({
      ok: true,
      pagesScanned: 5,
      batch: {
        provider: "kalshi",
        environment: "demo",
        ordersCursorComplete: true,
        fillsCursorComplete: true,
        orders: [{
          providerOrderId: "order-1",
          unitPriceMinor: 40,
          orderedQuantity: 10,
          filledQuantity: 4,
          remainingQuantity: 6,
        }],
        fills: [{ sourceKey: "fill:fill-1", quantity: 4, unitPriceMinor: 40 }],
      },
    });
    expect(calls).toEqual([
      "active:orders:first",
      "active:orders:orders-next",
      "historical:orders:first",
      "active:fills:first",
      "historical:fills:first",
    ]);
  });

  test("returns incomplete and no batch when any cursor chain exceeds its bound", async () => {
    const client = mockClient(() => ({ items: [], cursor: "still-more" }));
    expect(await loadKalshiLifecycleBatch(client, {
      outId: "out-SPORTS-1",
      maxPagesPerFeed: 1,
    })).toMatchObject({
      ok: false,
      kind: "incomplete",
      feed: "orders",
      source: "active",
      pagesScanned: 1,
    });
  });

  test("strict normalization rejects fractional execution quantities", async () => {
    const client = mockClient((feed, source) => ({
      items: feed === "orders" && source === "active"
        ? [{ ...orderWire(), initial_count_fp: "10.50" }]
        : [],
      cursor: "",
    }));
    expect(await loadKalshiLifecycleBatch(client, { outId: "out-SPORTS-1" }))
      .toMatchObject({ ok: false, kind: "malformed" });
  });

  test("NO buys and sells normalize to their maximum per-contract exposure", () => {
    expect(normalizeKalshiLifecycleOrder(orderWire()).unitPriceMinor).toBe(40);
    expect(normalizeKalshiLifecycleOrder({
      ...orderWire(),
      action: "sell",
    }).unitPriceMinor).toBe(60);
    expect(normalizeKalshiLifecycleFill(fillWire()).sourceKey).toBe("fill:fill-1");
  });
});

function mockClient(
  page: (
    feed: "orders" | "fills",
    source: "active" | "historical",
    cursor: string,
  ) => KalshiLifecyclePage | Promise<KalshiLifecyclePage>,
): Pick<KalshiClient, "environment" | "getLifecyclePage"> {
  return {
    environment: "demo",
    getLifecyclePage: (feed, source, cursor = "") => Promise.resolve(page(feed, source, cursor)),
  };
}

function orderWire(): Record<string, unknown> {
  return {
    order_id: "order-1",
    client_order_id: "client-1",
    ticker: "KXTEST",
    outcome_side: "no",
    action: "buy",
    status: "resting",
    yes_price_dollars: "0.6000",
    initial_count_fp: "10.00",
    fill_count_fp: "4.00",
    remaining_count_fp: "6.00",
    last_update_time: "2026-08-06T12:00:00Z",
  };
}

function fillWire(): Record<string, unknown> {
  return {
    fill_id: "fill-1",
    trade_id: "trade-1",
    order_id: "order-1",
    ticker: "KXTEST",
    side: "no",
    action: "buy",
    count_fp: "4.00",
    yes_price_dollars: "0.6000",
    fee_cost: "0.0400",
    created_time: "2026-08-06T12:00:01Z",
  };
}
