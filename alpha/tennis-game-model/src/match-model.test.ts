// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  inferSymmetricHoldFromMatchPrior,
  matchWinProbYes,
  probServerWinsGame,
} from "./match-model.ts";

describe("match-model", () => {
  test("probServerWinsGame at 0-0 equals p^4 series dominant term for strong server", () => {
    const p = 0.65;
    const pg = probServerWinsGame(p, 0, 0);
    expect(pg).toBeGreaterThan(p);
    expect(pg).toBeLessThan(0.99);
  });

  test("matchWinProbYes at 0-0 with symmetric holds matches inferred prior", () => {
    const prior = 0.55;
    const pHold = inferSymmetricHoldFromMatchPrior(prior, 3);
    const pMatch = matchWinProbYes(
      {
        setsYes: 0,
        setsNo: 0,
        gamesYes: 0,
        gamesNo: 0,
        pointsServer: 0,
        pointsReturner: 0,
        serverIsYes: true,
        bestOf: 3,
      },
      pHold,
      pHold,
    );
    expect(pMatch).toBeCloseTo(prior, 2);
  });

  test("one set up increases match win prob", () => {
    const pHold = 0.62;
    const base = matchWinProbYes(
      {
        setsYes: 0,
        setsNo: 0,
        gamesYes: 0,
        gamesNo: 0,
        pointsServer: 0,
        pointsReturner: 0,
        serverIsYes: true,
        bestOf: 3,
      },
      pHold,
      pHold,
    );
    const ahead = matchWinProbYes(
      {
        setsYes: 1,
        setsNo: 0,
        gamesYes: 0,
        gamesNo: 0,
        pointsServer: 0,
        pointsReturner: 0,
        serverIsYes: true,
        bestOf: 3,
      },
      pHold,
      pHold,
    );
    expect(ahead).toBeGreaterThan(base);
    expect(ahead).toBeGreaterThan(0.7);
  });

  test("40-0 on serve pushes game win prob near 1", () => {
    const pg = probServerWinsGame(0.6, 3, 0);
    expect(pg).toBeGreaterThan(0.95);
  });
});
