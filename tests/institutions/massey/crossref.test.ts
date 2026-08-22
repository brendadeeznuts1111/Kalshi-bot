// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  crossrefBookEvent,
  findMasseyMatch,
  masseyImpliedProbability,
  matchQuality,
  normalizeTeamName,
  type BookSkinEvent,
} from "../../../src/institutions/massey/crossref.ts";
import type { MasseyRatingRow } from "../../../src/institutions/massey/parse.ts";

const ROW: MasseyRatingRow = {
  rank: 1, team: "Nebraska", conference: "Big 10", teamCell: "NebraskaBig 10", record: "0-0 0.000",
  wins: 0, losses: 0, winPct: 0, delta: null, rating: 19.25, power: 14.88, hfa: 0.17,
  sos: 10, ssf: 193.46, ew: 22.24, el: 0.76,
};

describe("masseyImpliedProbability", () => {
  test("EW/(EW+EL) when projections exist", () => {
    expect(masseyImpliedProbability(ROW)).toBeCloseTo(22.24 / 23, 5);
  });

  test("falls back to record win pct", () => {
    const r = { ...ROW, ew: null, el: null, wins: 12, losses: 4, winPct: 0.75 };
    expect(masseyImpliedProbability(r)).toBeCloseTo(0.75, 5);
  });

  test("null when nothing usable", () => {
    expect(masseyImpliedProbability({ ...ROW, ew: null, el: null, wins: 0, losses: 0 })).toBeNull();
  });
});

describe("normalizeTeamName", () => {
  test("reorders LAST, First and strips punctuation", () => {
    expect(normalizeTeamName("FERRARI, GIANMARCO")).toBe("gianmarcoferrari");
  });

  test("drops parenthetical qualifiers", () => {
    expect(normalizeTeamName("Denmark Pro (Women)")).toBe("denmarkpro");
  });

  test("lowercases and strips spaces", () => {
    expect(normalizeTeamName("Nebraska")).toBe("nebraska");
    expect(normalizeTeamName("Texas Longhorns")).toBe("texaslonghorns");
  });
});

describe("matchQuality", () => {
  test("exact, strong containment, none", () => {
    expect(matchQuality("nebraska", "nebraska")).toBe("exact");
    expect(matchQuality("gianmarcoferrari", "ferrari")).toBe("strong");
    expect(matchQuality("denmarkpro", "italypro")).toBe("none");
    expect(matchQuality("abc", "abcdefgh")).toBe("none"); // too short for containment
  });
});

describe("findMasseyMatch", () => {
  test("prefers exact over strong", () => {
    const exact = new Map([["nebraska", ROW]]);
    const strong = new Map([["nebraska", ROW], ["texaslonghorns", { ...ROW, team: "Texas", rank: 2 }]]);
    const m = findMasseyMatch("nebraska", exact, strong);
    expect(m).toEqual({ team: "Nebraska", quality: "exact" });
  });
});

describe("crossrefBookEvent", () => {
  test("matches both sides and derives win pcts", () => {
    const rows = [ROW, { ...ROW, team: "Wisconsin", rank: 3, ew: 20.98, el: 4.02 }];
    const ev: BookSkinEvent = { league: "NCAA W VB", home: "Nebraska", away: "Wisconsin", competitionId: null };
    const res = crossrefBookEvent(ev, new Map([["cvol/ncaa-d1", rows]]));
    expect(res.covered).toBe(true);
    expect(res.homeMatch?.quality).toBe("exact");
    expect(res.awayMatch?.quality).toBe("exact");
    expect(res.homeWinPct).toBeCloseTo(22.24 / 23, 5);
    expect(res.awayWinPct).toBeCloseTo(20.98 / 25, 5);
    expect(res.masseyTarget).toBe("cvol/ncaa-d1");
  });


  test("short normalized names do not strong-match (length guard)", () => {
    const ev: BookSkinEvent = { league: "RU. League", home: "ro (Women)", away: "Saphire", competitionId: null };
    const res = crossrefBookEvent(ev, new Map([["cvol/ncaa-d1", [ROW]]]));
    expect(res.covered).toBe(false);
    expect(res.homeMatch).toBeNull();
  });
  test("uncovered when no team matches", () => {
    const ev: BookSkinEvent = { league: "Russia. League Pro. Women", home: "Saphire", away: "ro (Women)", competitionId: null };
    const res = crossrefBookEvent(ev, new Map([["cvol/ncaa-d1", [ROW]]]));
    expect(res.covered).toBe(false);
    expect(res.homeMatch).toBeNull();
  });
});