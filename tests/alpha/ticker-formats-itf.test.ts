// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  isItfKalshiTicker,
  parseItfEventTicker,
  parseItfMatchupBlob,
  parseItfYesSideCode,
  splitItfMatchupBlob,
  itfSideCodesForEvent,
} from "../../src/alpha/ticker-formats/itf.ts";

describe("ticker-formats/itf", () => {
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
});
