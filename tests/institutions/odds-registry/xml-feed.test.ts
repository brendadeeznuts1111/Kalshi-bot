/**
 * xml-feed tests — Bun.XML odds-heat -> OddsEvent normalization.
 */
import { describe, expect, test } from "bun:test";
import { americanToDecimal, parseOddsXmlEvents } from "../../../src/institutions/odds-registry/index.ts";

const FEED = '<odds-heat><cluster venue="Center Court"><print american="-150"/><print american="+120"/></cluster><cluster venue="Court 2"><print american="-200"/></cluster></odds-heat>';

describe("americanToDecimal", () => {
  test("positive and negative american odds", () => {
    expect(americanToDecimal(-150)).toBeCloseTo(1.6667, 3);
    expect(americanToDecimal(120)).toBe(2.2);
    expect(americanToDecimal(-200)).toBe(1.5);
  });
  test("guards NaN/zero", () => {
    expect(americanToDecimal(0)).toBeNull();
    expect(americanToDecimal(Number.NaN)).toBeNull();
  });
});

describe("parseOddsXmlEvents (Bun.XML)", () => {
  test("clusters -> OddsEvents with h2h outcomes (american prices, alpha contract)", () => {
    const events = parseOddsXmlEvents(FEED, { sportKey: "tennis_atp" });
    expect(events).toHaveLength(2);
    const e0 = events[0]!;
    expect(e0.sportKey).toBe("tennis_atp");
    expect(e0.homeTeam).toBe("Home"); // unnamed prints default
    expect(e0.bookmakers[0]!.title).toBe("Center Court");
    expect(e0.bookmakers[0]!.markets[0]!.outcomes[0]!.price).toBe(-150);
    expect(e0.bookmakers[0]!.markets[0]!.outcomes[1]!.price).toBe(120);
  });

  test("Blob input parses identically", () => {
    expect(parseOddsXmlEvents(new Blob([FEED]))).toEqual(parseOddsXmlEvents(FEED));
  });

  test("singleton cluster (object not array) is normalized", () => {
    const events = parseOddsXmlEvents('<odds-heat><cluster venue="Only"><print american="-110"/></cluster></odds-heat>');
    expect(events).toHaveLength(1);
    expect(events[0]!.bookmakers[0]!.title).toBe("Only");
  });

  test("unparseable american values are dropped", () => {
    const events = parseOddsXmlEvents('<odds-heat><cluster venue="X"><print american="zzz"/></cluster></odds-heat>');
    expect(events).toHaveLength(0);
  });

  test("event id derives from the MATCH (teams + commence), never the venue", () => {
    // Named prints + @commence -> match identity; the venue is a BOOKMAKER
    // (bookmaker key/title), not the event id.
    const events = parseOddsXmlEvents(
      '<odds-heat>'
        + '<cluster venue="bet365" commence="2026-09-01T19:00:00Z"><print name="Alpha FC" american="-200"/><print name="Beta FC" american="+150"/></cluster>'
        + '<cluster venue="pinnacle" commence="2026-09-01T19:00:00Z"><print name="Alpha FC" american="-190"/><print name="Beta FC" american="+160"/></cluster>'
        + '</odds-heat>',
      { sportKey: "soccer_epl" },
    );
    expect(events).toHaveLength(1);
    expect(String(events[0]!.id)).toBe("alpha-fc-vs-beta-fc-2026-09-01");
    // All venues land as bookmakers on the one event.
    expect(events[0]!.bookmakers.map((b) => b.key)).toEqual(["bet365", "pinnacle"]);
    expect(events[0]!.bookmakers[0]!.title).toBe("bet365");
  });

  test("clusters without match identity stay standalone placeholder events", () => {
    const events = parseOddsXmlEvents(FEED, { sportKey: "tennis_atp" });
    expect(events.map((e) => String(e.id))).toEqual(["event", "event"]);
    // The venue still identifies the BOOKMAKER even when the event cannot.
    expect(events[0]!.bookmakers[0]!.key).toBe("center-court");
  });
});
