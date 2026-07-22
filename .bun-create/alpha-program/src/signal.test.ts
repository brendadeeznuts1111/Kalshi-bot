// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  FEE,
  MIN_CONTRACTS,
  feeCents,
  feePerContractCents,
  passesThreshold,
  rawEdgeCents,
} from "./fees.ts";

describe("fees", () => {
  test("ceil is regressive at small size — 1 contract @ 50c pays 2c fee", () => {
    expect(feeCents(FEE.takerRate, 1, 50)).toBe(2);
    expect(feePerContractCents(FEE.takerRate, 1, 50)).toBe(2);
  });

  test("fee drag improves per-contract at 10 contracts @ 50c", () => {
    expect(feeCents(FEE.takerRate, 10, 50)).toBe(18);
    expect(feePerContractCents(FEE.takerRate, 10, 50)).toBeCloseTo(1.8, 5);
  });

  test("fees peak at 50c and shrink at tails", () => {
    expect(feeCents(FEE.takerRate, 5, 50)).toBeGreaterThan(feeCents(FEE.takerRate, 5, 5));
  });

  test("passesThreshold rejects below MIN_CONTRACTS", () => {
    expect(passesThreshold(0.6, 50, MIN_CONTRACTS - 1)).toBe(false);
  });

  test("rawEdgeCents is p_model×100 − priceCents only", () => {
    expect(rawEdgeCents(0.6, 55)).toBe(5);
  });
});
