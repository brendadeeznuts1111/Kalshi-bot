// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  isItfKalshiTicker,
  parseItfEventTicker,
  parseItfMatchupBlob,
  parseItfYesSideCode,
  splitItfMatchupBlob,
  itfSideCodesForEvent,
  itfMatchupBlobIsUnambiguous,
} from "../../../src/alpha/ticker-formats/itf.ts";

describe("itf", () => {
  test("parses ITF doubles example from Brisbane", () => {
    const don = "KXITFDOUBLES-26JUL21DONMARDELHOY-DONMAR";
    const del = "KXITFDOUBLES-26JUL21DONMARDELHOY-DELHOY";
    expect(isItfKalshiTicker(don)).toBe(true);
    expect(parseItfYesSideCode(don)).toBe("DONMAR");
    expect(parseItfYesSideCode(del)).toBe("DELHOY");
    expect(parseItfMatchupBlob(don)).toBe("DONMARDELHOY");
    expect(splitItfMatchupBlob("DONMARDELHOY", "DONMAR")).toEqual(["DONMAR", "DELHOY"]);
    expect(parseItfEventTicker(don)).toBe("KXITFDOUBLES-26JUL21DONMARDELHOY");
    expect(itfSideCodesForEvent(parseItfEventTicker(don)!, [don, del])).toEqual(["DELHOY", "DONMAR"]);
  });

  test("parses ITF singles codes", () => {
    const a = "KXITFMATCH-26JUL22SANALV-SAN";
    const b = "KXITFMATCH-26JUL22SANALV-ALV";
    expect(parseItfMatchupBlob(a)).toBe("SANALV");
    expect(splitItfMatchupBlob("SANALV", "SAN")).toEqual(["SAN", "ALV"]);
    expect(itfSideCodesForEvent(parseItfEventTicker(a)!, [a, b])).toEqual(["ALV", "SAN"]);
  });

  test("parses variable-length doubles codes", () => {
    const a = "KXITFDOUBLES-26JUL22JOHSTRBATSCH-JOHSTR";
    expect(parseItfMatchupBlob(a)).toBe("JOHSTRBATSCH");
    expect(splitItfMatchupBlob("JOHSTRBATSCH", "JOHSTR")).toEqual(["JOHSTR", "BATSCH"]);
  });

  test("hard-fails ambiguous prefix/suffix partitions", () => {
    // FOO is both prefix and suffix with different remainders
    expect(splitItfMatchupBlob("FOOBARFOO", "FOO")).toBeNull();
    expect(itfMatchupBlobIsUnambiguous("ZAKBAK", "ZAK", "BAK")).toBe(true);
    expect(itfMatchupBlobIsUnambiguous("AAAAAA", "AAA", "AAA")).toBe(false);
    // codes that do not concatenate to the blob
    expect(itfMatchupBlobIsUnambiguous("SANALV", "SAN", "XYZ")).toBe(false);
    const badA = "KXITFMATCH-26JUL22FOOBARFOO-FOO";
    const badB = "KXITFMATCH-26JUL22FOOBARFOO-BARFOO";
    // BARFOO + FOO would need to be validated — if sides don't uniquely partition, null
    expect(itfSideCodesForEvent("KXITFMATCH-26JUL22FOOBARFOO", [badA, badB])).toBeNull();
  });
});
