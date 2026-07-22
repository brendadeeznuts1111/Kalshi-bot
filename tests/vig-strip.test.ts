// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  americanToImplied,
  impliedProbabilities,
  impliedSideProbabilities,
  stripOverround,
} from "../src/alpha/vig-strip.ts";

describe("vig-strip", () => {
  test("americanToImplied positive and negative", () => {
    expect(americanToImplied(100)).toBeCloseTo(0.5, 5);
    expect(americanToImplied(-110)).toBeCloseTo(110 / 210, 5);
  });

  test("stripOverround normalizes to sum 1", () => {
    const out = stripOverround([0.55, 0.55]);
    expect(out[0]! + out[1]!).toBeCloseTo(1, 8);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });

  test("impliedProbabilities on symmetric -110/-110 yields 0.5 each", () => {
    const probs = impliedProbabilities({ home: -110, away: -110 });
    expect(probs[0]).toBeCloseTo(0.5, 4);
    expect(probs[1]).toBeCloseTo(0.5, 4);
  });

  test("impliedSideProbabilities preserves side keys", () => {
    const sides = impliedSideProbabilities({ home: -110, away: +100 });
    expect(sides.home + sides.away).toBeCloseTo(1, 6);
    expect(sides.home).toBeGreaterThan(sides.away);
  });
});
