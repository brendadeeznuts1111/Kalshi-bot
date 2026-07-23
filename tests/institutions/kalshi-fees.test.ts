// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  FEE,
  MAKER_FREE_SERIES,
  MIN_CONTRACTS,
  computeEdgeBreakdown,
  feeCents,
  feePerContractCents,
  kalshiFee,
  makerPassesThreshold,
  makerRateForSeries,
  passesThreshold,
  rawEdgeCents,
  seriesPrefixFromTicker,
  takerRateForSeries,
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

  test("maker-free series: ITF + Challenger pay 0 maker, tour pays 0.0175", () => {
    for (const series of [
      "KXITFMATCH",
      "KXITFWMATCH",
      "KXITFDOUBLES",
      "KXITFWDOUBLES",
      "KXATPCHALLENGERMATCH",
      "KXWTACHALLENGERMATCH",
    ]) {
      expect(makerRateForSeries(series)).toBe(0);
      expect(MAKER_FREE_SERIES.has(series)).toBe(true);
    }
    expect(makerRateForSeries("KXATPMATCH")).toBe(FEE.makerRate);
    expect(makerRateForSeries("KXWTAMATCH")).toBe(FEE.makerRate);
    expect(makerRateForSeries("KXMLBGAME")).toBe(FEE.makerRate);
    // Full tickers resolve via series prefix.
    expect(makerRateForSeries("KXITFMATCH-26JUL22SANALV-SAN")).toBe(0);
    expect(makerRateForSeries("KXATPMATCH-26JUL22BORBUR-BUR")).toBe(FEE.makerRate);
    expect(seriesPrefixFromTicker("KXATPMATCH-26JUL22BORBUR-BUR")).toBe("KXATPMATCH");
    expect(takerRateForSeries("KXITFMATCH")).toBe(FEE.takerRate);
  });

  test("maker gate passes thinner edge on maker-free series than taker gate", () => {
    // 5 lots @ 50c, 3c edge (p 0.53): taker fee 9c total (1.8c/contract) + 2c
    // margin = 3.8c > 3c edge → taker fails; maker-free fee 0 → 3c > 2c passes.
    expect(passesThreshold(0.53, 50, MIN_CONTRACTS)).toBe(false);
    expect(makerPassesThreshold(0.53, 50, MIN_CONTRACTS, "KXITFMATCH")).toBe(true);
    // Tour series still pay maker rate (0.6c/contract at this size vs 0 free).
    expect(feePerContractCents(makerRateForSeries("KXATPMATCH"), MIN_CONTRACTS, 50)).toBeCloseTo(0.6, 5);
    expect(feePerContractCents(makerRateForSeries("KXITFMATCH"), MIN_CONTRACTS, 50)).toBe(0);
    // Backward compat: positional rate arg unchanged, series is optional.
    expect(passesThreshold(0.6, 50, MIN_CONTRACTS, 2, FEE.takerRate)).toBe(true);
    expect(passesThreshold(0.6, 50, MIN_CONTRACTS, 2, undefined, "KXITFMATCH")).toBe(true);
  });
});
