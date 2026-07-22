// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  FEE,
  MIN_CONTRACTS,
  computeEdgeBreakdown,
  feeCents,
  feePerContractCents,
  kalshiFee,
  passesThreshold,
  rawEdgeCents,
} from "../../src/institutions/kalshi-fees.ts";
import { OFFICIAL_URLS } from "../../src/institutions/official-urls.ts";

describe("kalshi-fees", () => {
  test("fee schedule URL points at live page", () => {
    expect(OFFICIAL_URLS.kalshi.feeSchedule).toBe("https://kalshi.com/fee-schedule");
  });

  test("ceil regressive: 1 lot @ 50c = 2c total fee", () => {
    expect(feeCents(FEE.takerRate, 1, 50)).toBe(2);
  });

  test("10 lots @ 50c = 18c total, 1.8c per contract", () => {
    expect(feeCents(FEE.takerRate, 10, 50)).toBe(18);
    expect(feePerContractCents(FEE.takerRate, 10, 50)).toBeCloseTo(1.8, 5);
  });

  test("passesThreshold enforces MIN_CONTRACTS", () => {
    expect(passesThreshold(0.6, 50, MIN_CONTRACTS)).toBe(true);
    expect(passesThreshold(0.6, 50, MIN_CONTRACTS - 1)).toBe(false);
  });

  test("dollar helpers align with cent SSOT", () => {
    expect(kalshiFee(0.5, 1)).toBeCloseTo(0.02, 6);
    expect(rawEdgeCents(0.55, 50)).toBe(5);
    const b = computeEdgeBreakdown(0.55, 0.5, 0.02, MIN_CONTRACTS);
    expect(b.rawEdge).toBeCloseTo(0.05, 6);
  });
});
