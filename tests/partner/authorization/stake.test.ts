import { describe, expect, test } from "bun:test";
import {
  computeEffectiveStake,
  type StakeComputationInput,
} from "../../../src/partner/authorization/index.ts";

function input(overrides: Partial<StakeComputationInput> = {}): StakeComputationInput {
  return {
    requestedStake: 10_000,
    sitePerBetMax: 20_000,
    partnerApprovedMaxStake: 50_000,
    maxWin: 100_000,
    maxWinBasis: "profit",
    decimalOdds: 2,
    availableBalance: 100_000,
    dailyUsed: 0,
    dailyLimit: 1_000_000,
    outstandingExposure: 0,
    exposureLimit: 500_000,
    marketLiquidity: 100_000,
    ...overrides,
  };
}

describe("effective stake", () => {
  test("uses profit and total-return max-win bases", () => {
    expect(
      computeEffectiveStake(input({ requestedStake: 20_000, maxWin: 10_000, decimalOdds: 3 })),
    ).toBe(5_000);
    expect(
      computeEffectiveStake(
        input({
          requestedStake: 20_000,
          maxWin: 10_000,
          maxWinBasis: "total_return",
          decimalOdds: 3,
        }),
      ),
    ).toBe(3_333);
  });

  test("steps down when floating-point multiplication would exceed max win", () => {
    const effective = computeEffectiveStake(
      input({
        requestedStake: 100_000,
        sitePerBetMax: 100_000,
        partnerApprovedMaxStake: 100_000,
        maxWin: 987,
        decimalOdds: 1.0141,
      }),
    );
    expect(effective).toBe(69_999);
    expect(effective * (1.0141 - 1)).toBeLessThanOrEqual(987);
  });

  test("applies every monetary cap", () => {
    const capCases: Array<[Partial<StakeComputationInput>, number]> = [
      [{ requestedStake: 900 }, 900],
      [{ sitePerBetMax: 800 }, 800],
      [{ partnerApprovedMaxStake: 700 }, 700],
      [{ availableBalance: 600 }, 600],
      [{ marketLiquidity: 500 }, 500],
      [{ dailyLimit: 10_400, dailyUsed: 10_000 }, 400],
      [{ exposureLimit: 10_300, outstandingExposure: 10_000 }, 300],
    ];

    for (const [overrides, expected] of capCases) {
      expect(computeEffectiveStake(input(overrides))).toBe(expected);
    }
  });

  test("returns zero for exhausted or unknown executable capacity", () => {
    expect(computeEffectiveStake(input({ dailyLimit: 100, dailyUsed: 101 }))).toBe(0);
    expect(
      computeEffectiveStake(input({ exposureLimit: 100, outstandingExposure: 101 })),
    ).toBe(0);
    expect(computeEffectiveStake(input({ marketLiquidity: 0 }))).toBe(0);
  });

  test("fails closed for invalid odds and non-integer money", () => {
    for (const decimalOdds of [0, 1, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeEffectiveStake(input({ decimalOdds }))).toBe(0);
    }
    expect(computeEffectiveStake(input({ requestedStake: 1.5 }))).toBe(0);
    expect(computeEffectiveStake(input({ availableBalance: -1 }))).toBe(0);
    expect(computeEffectiveStake(input({ maxWin: Number.MAX_SAFE_INTEGER + 1 }))).toBe(0);
  });
});
