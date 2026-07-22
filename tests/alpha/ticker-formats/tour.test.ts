// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  detectTickerFormat,
  parseGameTeamCodes,
  teamNameMatchesCode,
  yesProbabilityFromSnapshot,
} from "../../../src/alpha/ticker-formats/index.ts";
import {
  isTourKalshiTicker,
  parseTourEventTicker,
  parseTourMatchupBlob,
  parseTourYesSideCode,
  splitTourMatchupBlob,
  tourSideCodesForEvent,
  tourMatchupBlobIsUnambiguous,
  tourFromSeries,
} from "../../../src/alpha/ticker-formats/tour.ts";

describe("tour", () => {
  test("parses ATP BORBUR example", () => {
    const bor = "KXATPMATCH-26JUL22BORBUR-BOR";
    const bur = "KXATPMATCH-26JUL22BORBUR-BUR";
    expect(isTourKalshiTicker(bor)).toBe(true);
    expect(detectTickerFormat(bor)).toBe("tour");
    expect(parseTourYesSideCode(bor)).toBe("BOR");
    expect(parseTourYesSideCode(bur)).toBe("BUR");
    expect(parseTourMatchupBlob(bor)).toBe("BORBUR");
    expect(splitTourMatchupBlob("BORBUR", "BOR")).toEqual(["BOR", "BUR"]);
    expect(parseTourEventTicker(bor)).toBe("KXATPMATCH-26JUL22BORBUR");
    expect(tourSideCodesForEvent(parseTourEventTicker(bor)!, [bor, bur])).toEqual(["BOR", "BUR"]);
    expect(tourFromSeries("KXATPMATCH")).toBe("ATP");
  });

  test("parses WTA tour match codes", () => {
    const a = "KXWTAMATCH-26JUL22SABGAU-SAB";
    const b = "KXWTAMATCH-26JUL22SABGAU-GAU";
    expect(isTourKalshiTicker(a)).toBe(true);
    expect(parseTourMatchupBlob(a)).toBe("SABGAU");
    expect(splitTourMatchupBlob("SABGAU", "SAB")).toEqual(["SAB", "GAU"]);
    expect(tourSideCodesForEvent(parseTourEventTicker(a)!, [a, b])).toEqual(["GAU", "SAB"]);
    expect(tourFromSeries("KXWTAMATCH")).toBe("WTA");
  });

  test("index helpers resolve tour yes-side vs home/away names", () => {
    const bor = "KXATPMATCH-26JUL22BORBUR-BOR";
    expect(parseGameTeamCodes(bor)).toEqual(["BOR", "BUR"]);
    expect(teamNameMatchesCode(bor, "BOR", "Borna Coric")).toBe(true);
    expect(teamNameMatchesCode(bor, "BUR", "Alex de Minaur")).toBe(false);
    expect(
      yesProbabilityFromSnapshot(bor, 0.62, 0.38, "Borna Coric", "Alex de Minaur"),
    ).toBe(0.62);
    expect(
      yesProbabilityFromSnapshot(
        "KXATPMATCH-26JUL22BORBUR-BUR",
        0.62,
        0.38,
        "Borna Coric",
        "Alex de Minaur",
      ),
    ).toBe(0.38);
  });

  test("hard-fails ambiguous prefix/suffix partitions", () => {
    expect(splitTourMatchupBlob("FOOBARFOO", "FOO")).toBeNull();
    expect(tourMatchupBlobIsUnambiguous("BORBUR", "BOR", "BUR")).toBe(true);
    expect(tourMatchupBlobIsUnambiguous("AAAAAA", "AAA", "AAA")).toBe(false);
    const badA = "KXATPMATCH-26JUL22FOOBARFOO-FOO";
    const badB = "KXATPMATCH-26JUL22FOOBARFOO-BARFOO";
    expect(tourSideCodesForEvent("KXATPMATCH-26JUL22FOOBARFOO", [badA, badB])).toBeNull();
  });
});
