import { describe, expect, test } from "bun:test";
import {
  dollarsToCents,
  fpToCount,
  normalizeBalance,
  normalizeFill,
  normalizeMarketPosition,
  normalizeOrder,
  isWorkingOrder,
} from "../../src/institutions/ledger-types.ts";
import { CODES, TOOLTIPS } from "../../src/institutions/glossary.ts";
import { ERROR_CODES, codedError, httpStatusFor } from "../../src/institutions/error-codes.ts";

describe("dollarsToCents", () => {
  test("parses fixed-point dollar strings", () => {
    expect(dollarsToCents("0.5600")).toBe(56);
    expect(dollarsToCents("10.00")).toBe(1000);
    expect(dollarsToCents("0.005")).toBe(1); // round-half-up
  });
  test("null/invalid → null", () => {
    expect(dollarsToCents(null)).toBeNull();
    expect(dollarsToCents(undefined)).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
  });
});

describe("fpToCount", () => {
  test("integer fp is not fractional", () => {
    expect(fpToCount("10.00")).toEqual({ value: 10, fractional: false });
  });
  test("fractional fp is flagged", () => {
    expect(fpToCount("2.5")).toEqual({ value: 2.5, fractional: true });
  });
});

describe("normalizeBalance", () => {
  test("legacy cents win over dollar string", () => {
    const b = normalizeBalance({ balance: 12345, balance_dollars: "999.99", updated_ts: 1700000000 });
    expect(b.balanceCents).toBe(12345);
    expect(b.updatedAtMs).toBe(1700000000_000);
  });
  test("falls back to dollars", () => {
    expect(normalizeBalance({ balance_dollars: "123.45" }).balanceCents).toBe(12345);
  });
  test("empty wire → nulls", () => {
    expect(normalizeBalance({}).balanceCents).toBeNull();
  });
});

describe("normalizeMarketPosition", () => {
  test("full wire maps to normalized", () => {
    const p = normalizeMarketPosition({
      ticker: "KXNBA-1",
      position: -3,
      market_exposure_dollars: "12.34",
      realized_pnl: 56,
      last_updated_ts: "2026-07-28T00:00:00Z",
    });
    expect(p.ticker).toBe("KXNBA-1");
    expect(p.position).toBe(-3);
    expect(p.fractional).toBe(false);
    expect(p.exposureCents).toBe(1234);
    expect(p.realizedPnlCents).toBe(56);
    expect(p.lastUpdatedAtMs).toBe(Date.parse("2026-07-28T00:00:00Z"));
  });
  test("fp-only position uses fp and flags fractional", () => {
    const p = normalizeMarketPosition({ ticker: "X", position_fp: "2.5" });
    expect(p.position).toBe(2.5);
    expect(p.fractional).toBe(true);
  });
});

describe("normalizeFill", () => {
  test("v2 wire with fp + dollars", () => {
    const f = normalizeFill({
      fill_id: "f1",
      trade_id: "t1",
      order_id: "o1",
      ticker: "KX-1",
      count_fp: "10.00",
      yes_price_dollars: "0.5600",
      is_taker: true,
      fee_cost: "0.04",
      created_time: "2023-11-07T05:31:56Z",
    });
    expect(f.count).toBe(10);
    expect(f.yesPriceCents).toBe(56);
    expect(f.feeCents).toBe(4);
    expect(f.isTaker).toBe(true);
  });
  test("legacy market_ticker alias", () => {
    expect(normalizeFill({ market_ticker: "LEG-1", count: 2 }).ticker).toBe("LEG-1");
  });
});

describe("normalizeOrder + isWorkingOrder", () => {
  const wire = {
    order_id: "o1",
    ticker: "KXNBA-1",
    side: "yes" as const,
    status: "resting" as const,
    yes_price: 42,
    remaining_count: 5,
  };
  test("maps core fields", () => {
    const o = normalizeOrder(wire);
    expect(o.yesPriceCents).toBe(42);
    expect(o.remainingCount).toBe(5);
    expect(isWorkingOrder(o)).toBe(true);
  });
  test("executed orders are not working", () => {
    expect(isWorkingOrder(normalizeOrder({ ...wire, status: "executed" }))).toBe(false);
  });
});

describe("glossary integrity", () => {
  test("codes are append-only uppercase short codes", () => {
    for (const code of Object.keys(CODES)) {
      expect(code).toMatch(/^[A-Z]{3,5}$/);
    }
  });
  test("every tooltip is a non-empty string", () => {
    for (const tip of Object.values(TOOLTIPS)) {
      expect(tip.length).toBeGreaterThan(10);
    }
  });
});

describe("error registry", () => {
  test("codedError carries code + message", () => {
    const e = codedError("E_PRICE_RANGE");
    expect(e.ok).toBe(false);
    expect(e.code).toBe("E_PRICE_RANGE");
    expect(e.error).toBe(ERROR_CODES.E_PRICE_RANGE.message);
    expect(httpStatusFor("E_PRICE_RANGE")).toBe(400);
  });
  test("upstream propagates", () => {
    expect(codedError("E_UPSTREAM", "HTTP 429").upstream).toBe("HTTP 429");
  });
});
