// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { simulateFillVwap, toxicityMovedAgainst } from "../src/institutions/shadow-sim.ts";

describe("shadow fill + toxicity", () => {
  test("simulateFillVwap walks depth and partials honestly", () => {
    const r = simulateFillVwap(
      [
        { priceCents: 50, size: 3 },
        { priceCents: 52, size: 10 },
      ],
      5,
    );
    expect(r.filledContracts).toBe(5);
    expect(r.vwapFillCents).toBe(Math.round((50 * 3 + 52 * 2) / 5));
  });

  test("toxicityMovedAgainst detects adverse mid move for yes", () => {
    expect(toxicityMovedAgainst("yes", 50, 48)).toBe(true);
    expect(toxicityMovedAgainst("yes", 50, 51)).toBe(false);
  });
});
