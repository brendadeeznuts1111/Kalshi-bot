// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  extractMatchupDateBlob,
  formatLadderCoverage,
  ladderFamilyFromTicker,
  marketKindFromTicker,
  summarizeLadderCoverage,
  TENNIS_LADDER_SERIES,
} from "../../src/institutions/event-store/tennis-ladder.ts";
import { asKalshiMarketTicker } from "../../src/institutions/event-store/brands.ts";

describe("tennis-ladder", () => {
  test("extracts shared matchup blob across sibling series", () => {
    expect(extractMatchupDateBlob("KXATPMATCH-26JUL22BORBUR")).toBe("26JUL22BORBUR");
    expect(extractMatchupDateBlob("KXATPSETWINNER-26JUL22BORBUR-2-BOR")).toBe("26JUL22BORBUR");
    expect(extractMatchupDateBlob("KXATPEXACTMATCH-26JUL22BORBUR-BOR21")).toBe("26JUL22BORBUR");
  });

  test("classifies market kinds and families", () => {
    expect(marketKindFromTicker("KXATPS1GWINNER-26JUL22BORBUR-1-3-BOR")).toBe("s1_game");
    expect(marketKindFromTicker("KXITFMATCH-26JUL22SANALV-SAN")).toBe("match_winner");
    expect(ladderFamilyFromTicker("KXITFMATCH-26JUL22SANALV-SAN")).toBe("itf");
    expect(ladderFamilyFromTicker("KXATPMATCH-26JUL22BORBUR-BOR")).toBe("atp");
    expect(TENNIS_LADDER_SERIES.itf.every((s) => marketKindFromTicker(`${s}-X`) === "match_winner")).toBe(
      true,
    );
  });

  test("coverage flags ITF ladder-empty and ATP WS cue", () => {
    const itf = summarizeLadderCoverage("itf", "26JUL22SANALV", [
      asKalshiMarketTicker("KXITFMATCH-26JUL22SANALV-SAN"),
      asKalshiMarketTicker("KXITFMATCH-26JUL22SANALV-ALV"),
    ]);
    // ITF family has no non-winner series in the catalog → ladderEmpty false (nothing missing)
    expect(itf.ladderEmpty).toBe(false);
    expect(itf.perPointOpen).toBe(false);

    const atpWinnersOnly = summarizeLadderCoverage("atp", "26JUL22BORBUR", [
      asKalshiMarketTicker("KXATPMATCH-26JUL22BORBUR-BOR"),
      asKalshiMarketTicker("KXATPMATCH-26JUL22BORBUR-BUR"),
    ]);
    expect(atpWinnersOnly.ladderEmpty).toBe(true);

    const atpLive = summarizeLadderCoverage("atp", "26JUL22BORBUR", [
      asKalshiMarketTicker("KXATPMATCH-26JUL22BORBUR-BOR"),
      asKalshiMarketTicker("KXATPS1GWINNER-26JUL22BORBUR-1-3-BOR"),
    ]);
    expect(atpLive.perPointOpen).toBe(true);
    expect(formatLadderCoverage(atpLive)).toContain("WS_CUE");
  });
});
