// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  clampProb,
  logit,
  scoreAdjustedPModel,
  SET_LOGIT_WEIGHT,
  sigmoid,
} from "./score-model.ts";

describe("score-model", () => {
  test("clampProb bounds to 0.02–0.98", () => {
    expect(clampProb(0)).toBe(0.02);
    expect(clampProb(1)).toBe(0.98);
    expect(clampProb(0.5)).toBe(0.5);
  });

  test("logit and sigmoid are inverses in the interior", () => {
    const p = 0.55;
    expect(sigmoid(logit(p))).toBeCloseTo(p, 5);
  });

  test("not live returns prior unchanged", () => {
    const result = scoreAdjustedPModel({
      priorP: 0.5,
      setsYes: 2,
      setsNo: 0,
      gamesYes: 5,
      gamesNo: 3,
      isLive: false,
    });
    expect(result.pModel).toBe(0.5);
    expect(result.setDelta).toBe(2);
    expect(result.gameDelta).toBe(2);
  });

  test("live shifts logit by set and game deltas", () => {
    const priorP = 0.5;
    const setDelta = 1;
    const gameDelta = 3;
    const expected = clampProb(
      sigmoid(logit(priorP) + setDelta * SET_LOGIT_WEIGHT + gameDelta * 0.08),
    );
    const result = scoreAdjustedPModel({
      priorP,
      setsYes: 2,
      setsNo: 1,
      gamesYes: 5,
      gamesNo: 2,
      isLive: true,
    });
    expect(result.setDelta).toBe(1);
    expect(result.gameDelta).toBe(3);
    expect(result.pModel).toBeCloseTo(expected, 8);
    expect(result.pModel).toBeGreaterThan(priorP);
  });

  test("live favorite ahead increases p_model", () => {
    const ahead = scoreAdjustedPModel({
      priorP: 0.45,
      setsYes: 1,
      setsNo: 0,
      gamesYes: 4,
      gamesNo: 2,
      isLive: true,
    });
    const behind = scoreAdjustedPModel({
      priorP: 0.45,
      setsYes: 0,
      setsNo: 1,
      gamesYes: 2,
      gamesNo: 4,
      isLive: true,
    });
    expect(ahead.pModel).toBeGreaterThan(0.45);
    expect(behind.pModel).toBeLessThan(0.45);
  });
});
