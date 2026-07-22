// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  parseMatchupBlob,
  splitMatchupBlob,
  sideCodesForEvent,
  parseEventTicker,
  parseYesSideCode,
} from "../../../src/alpha/ticker-formats/series-parse.ts";

const ITF = ["KXITFMATCH", "KXITFWMATCH"] as const;

describe("series-parse", () => {
  test("parseMatchupBlob SANALV from KXITFMATCH-26JUL22SANALV-SAN", () => {
    const ticker = "KXITFMATCH-26JUL22SANALV-SAN";
    expect(parseMatchupBlob(ticker, ITF)).toBe("SANALV");
    expect(parseYesSideCode(ticker, ITF)).toBe("SAN");
    expect(parseEventTicker(ticker, ITF)).toBe("KXITFMATCH-26JUL22SANALV");
  });

  test("splitMatchupBlob ambiguous hard-fail", () => {
    expect(splitMatchupBlob("FOOBARFOO", "FOO")).toBeNull();
    expect(splitMatchupBlob("", "SAN")).toBeNull();
    expect(splitMatchupBlob("SANALV", "")).toBeNull();
  });

  test("sideCodesForEvent success case", () => {
    const a = "KXITFMATCH-26JUL22SANALV-SAN";
    const b = "KXITFMATCH-26JUL22SANALV-ALV";
    const event = parseEventTicker(a, ITF)!;
    expect(sideCodesForEvent(ITF, event, [a, b])).toEqual(["ALV", "SAN"]);
  });
});
