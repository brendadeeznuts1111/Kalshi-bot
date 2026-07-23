// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  inferHoldsFromMatchPrior,
  matchWinProbYes,
  probServerWinsGame,
  type MatchScoreState,
} from "./match-model.ts";

function state(patch: Partial<MatchScoreState> = {}): MatchScoreState {
  return {
    setsYes: 0,
    setsNo: 0,
    gamesYes: 0,
    gamesNo: 0,
    pointsServer: 0,
    pointsReturner: 0,
    serverIsYes: true,
    bestOf: 3,
    ...patch,
  };
}

describe("match-model", () => {
  test("probServerWinsGame at 0-0 exceeds per-point p for strong server", () => {
    const p = 0.65;
    const pg = probServerWinsGame(p, 0, 0);
    expect(pg).toBeGreaterThan(p);
    expect(pg).toBeLessThan(0.99);
  });

  test("closed form: game probability from deuce = p²/(p²+(1-p)²)", () => {
    for (const p of [0.5, 0.6, 0.65, 0.7]) {
      const expected = (p * p) / (p * p + (1 - p) * (1 - p));
      expect(probServerWinsGame(p, 3, 3)).toBeCloseTo(expected, 6);
    }
  });

  test("symmetric equal players: P(match) at 0-0 ≈ 0.50 and deciding set ≈ 0.50", () => {
    const pHold = 0.62;
    const pMatch = matchWinProbYes(state(), pHold, pHold);
    expect(Math.abs(pMatch - 0.5)).toBeLessThanOrEqual(0.01);
    // 1-1 sets, fresh set = pure set win probability.
    const pSet = matchWinProbYes(state({ setsYes: 1, setsNo: 1 }), pHold, pHold);
    expect(Math.abs(pSet - 0.5)).toBeLessThanOrEqual(0.01);
  });

  test("symmetric sanity: set + 5-0 games with serve > 0.9; set down + 0-5 < 0.1", () => {
    const pHold = 0.62;
    const ahead = matchWinProbYes(
      state({ setsYes: 1, gamesYes: 5, gamesNo: 0, serverIsYes: true }),
      pHold,
      pHold,
    );
    expect(ahead).toBeGreaterThan(0.9);
    const behind = matchWinProbYes(
      state({ setsNo: 1, gamesYes: 0, gamesNo: 5, serverIsYes: false }),
      pHold,
      pHold,
    );
    expect(behind).toBeLessThan(0.1);
  });

  test("return games credit YES with the break, not NO's hold (direction check)", () => {
    // Asymmetric: stronger YES player must be > 0.5.
    const pMatch = matchWinProbYes(state({ serverIsYes: true }), 0.68, 0.58);
    expect(pMatch).toBeGreaterThan(0.5);
    // With a fair alternating-serve tiebreak, i.i.d. serve order is provably
    // neutral at 0-0 — first-serve must NOT manufacture edge.
    const pMatchNoServe = matchWinProbYes(state({ serverIsYes: false }), 0.68, 0.58);
    expect(pMatchNoServe).toBeCloseTo(pMatch, 6);
    // Mirror: swapping hold strengths and serve axis inverts the probability.
    const mirror = matchWinProbYes(state({ serverIsYes: false }), 0.58, 0.68);
    expect(mirror).toBeCloseTo(1 - pMatch, 6);
  });

  test("inferHoldsFromMatchPrior round-trips against the fixed recursion", () => {
    for (const prior of [0.5, 0.55, 0.65]) {
      const { pHoldYes, pHoldNo } = inferHoldsFromMatchPrior(prior, 3);
      const pMatch = matchWinProbYes(state(), pHoldYes, pHoldNo);
      expect(pMatch).toBeCloseTo(prior, 2);
    }
  });

  test("one set up increases match win prob", () => {
    const pHold = 0.62;
    const base = matchWinProbYes(state(), pHold, pHold);
    const ahead = matchWinProbYes(state({ setsYes: 1 }), pHold, pHold);
    expect(ahead).toBeGreaterThan(base);
    expect(ahead).toBeGreaterThan(0.7);
  });

  test("40-0 on serve pushes game win prob near 1", () => {
    const pg = probServerWinsGame(0.6, 3, 0);
    expect(pg).toBeGreaterThan(0.95);
  });
});
