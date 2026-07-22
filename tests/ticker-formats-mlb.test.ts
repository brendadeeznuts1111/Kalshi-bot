// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  mlbYesIsHomeTeam,
  mlbYesTeamCodes,
  parseMlbMatchupBlob,
  parseMlbYesTeamCode,
  splitMlbMatchupBlob,
  yesProbabilityFromSnapshot,
} from "../src/alpha/ticker-formats/index.ts";

describe("MLB ticker format", () => {
  test("parseMlbYesTeamCode reads suffix team", () => {
    expect(parseMlbYesTeamCode("KXMLBGAME-26JUL242010ATHMIN-MIN")).toBe("MIN");
    expect(parseMlbYesTeamCode("KXMLBGAME-26JUL242215LAASF-SF")).toBe("SF");
  });

  test("splitMlbMatchupBlob splits ATHMIN and LAASF", () => {
    expect(splitMlbMatchupBlob("ATHMIN")).toEqual(["ATH", "MIN"]);
    expect(splitMlbMatchupBlob("LAASF")).toEqual(["LAA", "SF"]);
  });

  test("parseMlbMatchupBlob from full ticker", () => {
    expect(parseMlbMatchupBlob("KXMLBGAME-26JUL242010ATHMIN-MIN")).toBe("ATHMIN");
  });

  test("yesProbabilityFromSnapshot uses suffix team for MLB", () => {
    const ticker = "KXMLBGAME-26JUL242010ATHMIN-MIN";
    const home = 0.55;
    const away = 0.45;
    expect(
      yesProbabilityFromSnapshot(ticker, home, away, "Minnesota Twins", "Oakland Athletics"),
    ).toBe(home);
    expect(mlbYesIsHomeTeam(ticker, "Minnesota Twins", "Oakland Athletics")).toBe(true);
    expect(mlbYesTeamCodes(ticker)).toEqual(["ATH", "MIN"]);
  });
});
