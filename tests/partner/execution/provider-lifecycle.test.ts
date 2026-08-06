import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  computeProviderOrderExposure,
  getProviderOrderFillTotals,
  getProviderOrderLifecycle,
  ingestProviderLifecycleBatch,
  recordProviderOrderSettlement,
  type ProviderLifecycleBatch,
} from "../../../src/partner/execution/provider-lifecycle.ts";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";

const NOW = 1_700_000_000_000;

describe("provider order lifecycle", () => {
  test("migration is upgrade-safe and idempotent", () => {
    const db = new Database(":memory:");
    expect(migrateExecutionSchema(db, NOW)).toContain("004_provider_order_lifecycle");
    expect(migrateExecutionSchema(db, NOW + 1)).toEqual([]);
    const tables = db.query(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'provider_order_%' ORDER BY name`,
    ).all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual([
      "provider_order_fills",
      "provider_order_lifecycle",
      "provider_order_settlements",
    ]);
    db.close();
  });

  test("migration canonicalizes equivalent legacy sell directions", () => {
    const db = setup();
    ingestProviderLifecycleBatch(db, batch({
      orders: [{ ...batch().orders[0]!, side: "no", action: "sell", unitPriceMinor: 60 }],
      fills: [{ ...batch().fills[0]!, side: "no", action: "sell", unitPriceMinor: 60 }],
    }));
    db.query("DELETE FROM _partner_execution_migrations WHERE id = $id")
      .run({ $id: "010_canonical_provider_direction" });
    expect(migrateExecutionSchema(db, NOW + 1)).toEqual(["010_canonical_provider_direction"]);
    expect(getProviderOrderLifecycle(db, "kalshi", "out-SPORTS-1", "order-1"))
      .toMatchObject({ side: "yes", action: "buy", unitPriceMinor: 60 });
    expect(db.query(
      "SELECT side, action, unit_price_minor AS unitPriceMinor FROM provider_order_fills",
    ).get()).toEqual({ side: "yes", action: "buy", unitPriceMinor: 60 });
    db.close();
  });

  test("tracks 10/4/6 partial exposure, releases only six on cancel, then settles four", () => {
    const db = setup();
    ingestProviderLifecycleBatch(db, batch());
    const partial = getProviderOrderLifecycle(db, "kalshi", "out-SPORTS-1", "order-1")!;
    expect(partial).toMatchObject({
      orderedQuantity: 10,
      filledQuantity: 4,
      remainingQuantity: 6,
      cancelledQuantity: 0,
      settledQuantity: 0,
    });
    expect(computeProviderOrderExposure(partial)).toEqual({
      workingQuantity: 6,
      filledUnsettledQuantity: 4,
      cancelledQuantity: 0,
      settledQuantity: 0,
      workingExposureMinor: 240,
      filledExposureMinor: 160,
      totalExposureMinor: 400,
    });
    expect(getProviderOrderFillTotals(db, "kalshi", "out-SPORTS-1", "order-1"))
      .toEqual({ quantity: 4, costMinor: 160, feesMinor: 2 });

    ingestProviderLifecycleBatch(db, batch({
      observedAtMs: NOW + 1,
      orders: [{ ...batch().orders[0]!, status: "cancelled", remainingQuantity: 0 }],
    }));
    const cancelled = getProviderOrderLifecycle(db, "kalshi", "out-SPORTS-1", "order-1")!;
    expect(computeProviderOrderExposure(cancelled)).toEqual({
      workingQuantity: 0,
      filledUnsettledQuantity: 4,
      cancelledQuantity: 6,
      settledQuantity: 0,
      workingExposureMinor: 0,
      filledExposureMinor: 160,
      totalExposureMinor: 160,
    });

    const settled = recordProviderOrderSettlement(db, {
      provider: "kalshi",
      outId: "out-SPORTS-1",
      providerOrderId: "order-1",
      evidenceKey: "market:KXTEST:settled:yes",
      settledQuantity: 4,
      observedAtMs: NOW + 2,
    });
    expect(computeProviderOrderExposure(settled).totalExposureMinor).toBe(0);
    expect(recordProviderOrderSettlement(db, {
      provider: "kalshi",
      outId: "out-SPORTS-1",
      providerOrderId: "order-1",
      evidenceKey: "market:KXTEST:settled:yes",
      settledQuantity: 4,
      observedAtMs: NOW + 3,
    }).settledQuantity).toBe(4);
    db.close();
  });

  test("deduplicates repeated fill pages and rejects source-key mutation atomically", () => {
    const db = setup();
    const duplicated = batch({ fills: [batch().fills[0]!, batch().fills[0]!] });
    expect(ingestProviderLifecycleBatch(db, duplicated)).toMatchObject({
      fillsInserted: 1,
      fillsDuplicate: 1,
    });
    expect(ingestProviderLifecycleBatch(db, { ...duplicated, observedAtMs: NOW + 1 }))
      .toMatchObject({ fillsInserted: 0, fillsDuplicate: 2 });
    expect(db.query("SELECT COUNT(*) AS count FROM provider_order_fills").get())
      .toEqual({ count: 1 });

    expect(() => ingestProviderLifecycleBatch(db, batch({
      observedAtMs: NOW + 2,
      fills: [{ ...batch().fills[0]!, quantity: 3 }],
    }))).toThrow(/source key.*different terms/);
    expect(getProviderOrderLifecycle(db, "kalshi", "out-SPORTS-1", "order-1"))
      .toMatchObject({ filledQuantity: 4, remainingQuantity: 6 });
    db.close();
  });

  test("fails closed before writes for incomplete cursor chains", () => {
    const db = setup();
    expect(() => ingestProviderLifecycleBatch(db, batch({ ordersCursorComplete: false })))
      .toThrow(/cursor-complete/);
    expect(() => ingestProviderLifecycleBatch(db, batch({ fillsCursorComplete: false })))
      .toThrow(/cursor-complete/);
    expect(db.query("SELECT COUNT(*) AS count FROM provider_order_lifecycle").get())
      .toEqual({ count: 0 });
    db.close();
  });

  test("requires provider-positive settlement within the filled quantity", () => {
    const db = setup();
    ingestProviderLifecycleBatch(db, batch());
    expect(() => recordProviderOrderSettlement(db, {
      provider: "kalshi",
      outId: "out-SPORTS-1",
      providerOrderId: "order-1",
      evidenceKey: "bad-settlement",
      settledQuantity: 5,
      observedAtMs: NOW + 1,
    })).toThrow(/cannot exceed.*filled/);
    expect(getProviderOrderLifecycle(db, "kalshi", "out-SPORTS-1", "order-1")?.settledQuantity)
      .toBe(0);
    db.close();
  });
});

function setup(): Database {
  const db = new Database(":memory:");
  migrateExecutionSchema(db, NOW);
  return db;
}

function batch(overrides: Partial<ProviderLifecycleBatch> = {}): ProviderLifecycleBatch {
  return {
    provider: "kalshi",
    outId: "out-SPORTS-1",
    environment: "demo",
    observedAtMs: NOW,
    ordersCursorComplete: true,
    fillsCursorComplete: true,
    orders: [{
      providerOrderId: "order-1",
      clientOrderId: "client-1",
      reservationId: null,
      ticker: "KXTEST",
      side: "yes",
      action: "buy",
      unitPriceMinor: 40,
      orderedQuantity: 10,
      filledQuantity: 4,
      remainingQuantity: 6,
      status: "working",
      providerUpdatedAtMs: NOW,
    }],
    fills: [{
      sourceKey: "fill:fill-1",
      providerOrderId: "order-1",
      ticker: "KXTEST",
      side: "yes",
      action: "buy",
      quantity: 4,
      unitPriceMinor: 40,
      feeMinor: 2,
      providerCreatedAtMs: NOW,
    }],
    ...overrides,
  };
}
