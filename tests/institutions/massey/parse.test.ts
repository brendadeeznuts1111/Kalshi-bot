// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  parseMasseyNumber,
  parseMasseyRecord,
  parseMasseyRatingRows,
  splitMasseyTeamConference,
  DEFAULT_MASSEY_CONFERENCES,
} from "../../../src/institutions/massey/parse.ts";

/** Fixture from the real cvol/ncaa-d1 page (2026-08-22 capture). */
const HEADERS = ["Team", "Rec", "Δ", "Rat", "Pwr", "HFA", "SoS", "SSF", "EW", "EL"];

const ROWS: string[][] = [
  [], // spacer
  ["Correlation", "NaN", "", "1000", "1000", "-210", "NaN", "887", "727", "-717"], // meta row
  ["NebraskaBig 10", "0-0 0.000", "", "19.25", "14.88", "0.17", "10.00", "193.46", "22.24", "0.76"],
  ["Morehead St", "0-0 0.000", "", "-10.42", "-7.19", "0.08", "-6.50", "120.11", "10.35", "3.11"],
  ["StanfordPac-12", "1-0 1.000", "+0.5", "21.00", "15.00", "0.20", "12.00", "200.00", "25.00", "0.50"],
];

describe("parseMasseyNumber", () => {
  test("parses decimals and negatives, nulls empties/NaN/dash", () => {
    expect(parseMasseyNumber("19.25")).toBe(19.25);
    expect(parseMasseyNumber("-210")).toBe(-210);
    expect(parseMasseyNumber("0.76")).toBe(0.76);
    expect(parseMasseyNumber("")).toBeNull();
    expect(parseMasseyNumber("NaN")).toBeNull();
    expect(parseMasseyNumber("-")).toBeNull();
  });
});

describe("parseMasseyRecord", () => {
  test("parses W-L and win pct", () => {
    expect(parseMasseyRecord("0-0 0.000")).toEqual({ wins: 0, losses: 0, winPct: 0 });
    expect(parseMasseyRecord("1-0 1.000")).toEqual({ wins: 1, losses: 0, winPct: 1 });
    expect(parseMasseyRecord("12-4 0.750")).toEqual({ wins: 12, losses: 4, winPct: 0.75 });
    expect(parseMasseyRecord("")).toEqual({ wins: null, losses: null, winPct: null });
  });
});

describe("splitMasseyTeamConference", () => {
  test("strips known conference suffixes, longest match wins", () => {
    const { team, conference } = splitMasseyTeamConference("NebraskaBig 10", DEFAULT_MASSEY_CONFERENCES);
    expect(team).toBe("Nebraska");
    expect(conference).toBe("Big 10");
  });

  test("leaves conference-less cells intact", () => {
    const { team, conference } = splitMasseyTeamConference("Morehead St", DEFAULT_MASSEY_CONFERENCES);
    expect(team).toBe("Morehead St");
    expect(conference).toBe("");
  });

  test("handles Pac-12-style suffixes", () => {
    const { team, conference } = splitMasseyTeamConference("StanfordPac-12", DEFAULT_MASSEY_CONFERENCES);
    expect(team).toBe("Stanford");
    expect(conference).toBe("Pac-12");
  });
});

describe("parseMasseyRatingRows", () => {
  test("maps columns by header, skips spacer and Correlation meta rows", () => {
    const rows = parseMasseyRatingRows(HEADERS, ROWS);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.team).toBe("Nebraska");
    expect(rows[0]!.conference).toBe("Big 10");
    expect(rows[0]!.rating).toBe(19.25);
    expect(rows[0]!.power).toBe(14.88);
    expect(rows[0]!.hfa).toBe(0.17);
    expect(rows[0]!.sos).toBe(10);
    expect(rows[0]!.ssf).toBe(193.46);
    expect(rows[0]!.ew).toBe(22.24);
    expect(rows[0]!.el).toBe(0.76);
    expect(rows[0]!.wins).toBe(0);
    expect(rows[0]!.losses).toBe(0);
    expect(rows[1]!.team).toBe("Morehead St");
    expect(rows[2]!.team).toBe("Stanford");
    expect(rows[2]!.winPct).toBe(1);
  });

  test("empty headers yield no rows", () => {
    expect(parseMasseyRatingRows([], ROWS)).toHaveLength(0);
  });

  test("respects limit option", () => {
    const rows = parseMasseyRatingRows(HEADERS, ROWS, { limit: 2 });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.team).toBe("Nebraska");
  });
});
