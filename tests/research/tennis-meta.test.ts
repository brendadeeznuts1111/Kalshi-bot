import { describe, expect, test } from "bun:test";
import {
  cityFromTournament,
  countryForPlayer,
  countryForTournament,
  leagueFromSeries,
  nationalityForPlayer,
  normalizeKey,
  parseRulesTournament,
  surfaceForTournament,
  tierFromTournament,
} from "../../src/research/tennis-meta.ts";

describe("leagueFromSeries", () => {
  test("maps all six tracked series", () => {
    expect(leagueFromSeries("KXATPMATCH")).toEqual({ league: "ATP", tour: "ATP", level: "tour" });
    expect(leagueFromSeries("KXWTAMATCH")!.league).toBe("WTA");
    expect(leagueFromSeries("KXATPCHALLENGERMATCH")!.level).toBe("challenger");
    expect(leagueFromSeries("KXWTACHALLENGERMATCH")!.league).toBe("WTA 125");
    expect(leagueFromSeries("KXITFMATCH")!.tour).toBe("ITF");
    expect(leagueFromSeries("KXITFWMATCH")!.league).toBe("ITF Women");
  });
  test("unknown series → null", () => {
    expect(leagueFromSeries("KXNBAMATCH")).toBeNull();
  });
});

describe("parseRulesTournament", () => {
  test("parses ITF rules text", () => {
    const rules =
      "If Jerry Roddick wins the Roddick vs Gamble professional tennis match in the 2026 M25 Edwardsville IL Round of 16 after a ball has been played, then the market resolves to Yes.";
    expect(parseRulesTournament(rules)).toEqual({
      year: 2026,
      tournament: "M25 Edwardsville IL",
      round: "Round of 16",
    });
  });
  test("parses tour-level rules text", () => {
    const rules =
      "If Jenson Brooksby wins the Brooksby vs Moutet professional tennis match in the 2026 ATP Los Cabos Round Of 32 after a ball has been played, then the market resolves to Yes.";
    const p = parseRulesTournament(rules);
    expect(p!.tournament).toBe("ATP Los Cabos");
    expect(p!.round).toBe("Round Of 32");
  });
  test("no match → null", () => {
    expect(parseRulesTournament("unrelated rules")).toBeNull();
    expect(parseRulesTournament(null)).toBeNull();
  });
});

describe("geo + player lookups", () => {
  test("normalizeKey strips accents and punctuation", () => {
    expect(normalizeKey("Rogaska Slatina")).toBe("rogaska slatina");
    expect(normalizeKey("Nogent-sur-Marne")).toBe("nogent sur marne");
  });
  test("countryForTournament drops leading level tokens", () => {
    expect(countryForTournament("M25 Edwardsville IL")).toBe("United States");
    expect(countryForTournament("ATP Los Cabos")).toBe("Mexico");
    expect(countryForTournament("W75 Cordenons")).toBe("Italy");
  });
  test("unknown tournament → null (never guesses)", () => {
    expect(countryForTournament("M15 Nowheresville")).toBeNull();
    expect(countryForTournament(null)).toBeNull();
  });
  test("cityFromTournament strips level prefix", () => {
    expect(cityFromTournament("M25 Edwardsville IL")).toBe("Edwardsville IL");
    expect(cityFromTournament("ATP Challenger Bonn")).toBe("Bonn");
    expect(cityFromTournament(null)).toBeNull();
  });
  test("countryForPlayer honors seed, null for unknown", () => {
    expect(countryForPlayer("Venus Williams")).toBe("United States");
    expect(countryForPlayer("Some Unknown Player")).toBeNull();
  });
});

describe("tierFromTournament + harvest-backed lookups", () => {
  test("ITF levels incl. 50/75", () => {
    expect(tierFromTournament("W50 Dublin")).toBe("ITF50");
    expect(tierFromTournament("W75 Hechingen")).toBe("ITF75");
    expect(tierFromTournament("M25 Edwardsville IL")).toBe("ITF25");
    expect(tierFromTournament("W100 Gran Canaria-Maspalomas")).toBe("ITF100");
  });
  test("tour tiers + challenger + slams", () => {
    expect(tierFromTournament("ATP Challenger Bonn")).toBe("CH");
    expect(tierFromTournament("Wimbledon")).toBe("GS");
  });
  test("named events resolve via tournament-tiers seed", () => {
    expect(tierFromTournament("ATP Los Cabos")).toBe("250");
    expect(tierFromTournament("ATP Washington")).toBe("500");
    expect(tierFromTournament("WTA Memphis")).toBeNull(); // unconfirmed — never guess
  });
  test("normalizeKey strips parenthetical disambiguators", () => {
    expect(normalizeKey("Kenta Miyoshi (b. 2004)")).toBe("kenta miyoshi");
  });
  test("Stadion-harvested nationality dictionary resolves ITF players", () => {
    const nat = nationalityForPlayer("Ane Mintegi Del Olmo");
    expect(nat?.iso3).toBe("ESP");
    expect(nat?.country).toBe("Spain");
  });
  test("manual seed wins over harvest", () => {
    expect(countryForPlayer("Jenson Brooksby")).toBe("United States");
  });
  test("SPECIAL events tier", () => {
    expect(tierFromTournament("Nitto ATP Finals")).toBe("SPECIAL");
    expect(tierFromTournament("Olympics")).toBe("SPECIAL");
    expect(tierFromTournament("Davis Cup Finals")).toBe("SPECIAL");
  });
  test("surfaceForTournament from harvested + manual seed", () => {
    expect(surfaceForTournament("Wimbledon")).toBe("Grass");
    expect(surfaceForTournament("ATP Los Cabos")).toBe("Hard");
    expect(surfaceForTournament("M15 Nowheresville")).toBeNull(); // unknown — never guess
  });
});
