/**
 * value-pattern tests: consensus vs venue detector on synthetic odds-heat events.
 */
import { describe, expect, test } from "bun:test";
import {
  detectValuePatterns,
  kalshiCentsToImplied,
  parseOddsXmlEvents,
} from "../../../src/institutions/odds-registry/index.ts";

/** Four venues quoting the same match — a real consensus pocket (~62.5% home). */
const FIXTURE = `<odds-heat>`
  + `<cluster venue="bet365" commence="2026-03-01T19:00:00Z"><home team="Alpha"/><away team="Beta"/>`
  + `<print name="Alpha" american="-200"/><print name="Beta" american="+150"/></cluster>`
  + `<cluster venue="pinnacle" commence="2026-03-01T19:00:00Z"><home team="Alpha"/><away team="Beta"/>`
  + `<print name="Alpha" american="-190"/><print name="Beta" american="+160"/></cluster>`
  + `<cluster venue="draftkings" commence="2026-03-01T19:00:00Z"><home team="Alpha"/><away team="Beta"/>`
  + `<print name="Alpha" american="-210"/><print name="Beta" american="+145"/></cluster>`
  + `<cluster venue="williamhill" commence="2026-03-01T19:00:00Z"><home team="Alpha"/><away team="Beta"/>`
  + `<print name="Alpha" american="-205"/><print name="Beta" american="+150"/></cluster>`
  + `</odds-heat>`;

describe("value-pattern detector", () => {
  const events = parseOddsXmlEvents(FIXTURE, { sportKey: "soccer_epl", market: "h2h", commenceTime: "2026-03-01T19:00:00Z" });
  const ev = events[0]!;
  const eventId = ev.id;

  test("venue priced well below consensus is flagged venue_undervalued", () => {
    // consensus for home ≈ 65%; venue at 45% is a 20pp gap
    const patterns = detectValuePatterns(events, [
      { eventId, venue: "kalshi", side: "Alpha", implied: 0.45 },
    ]);
    const hit = patterns.find((p) => p.kind === "venue_undervalued");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("high");
    expect(hit!.venue).toBe("kalshi");
    expect(hit!.gap).toBeLessThanOrEqual(-0.04);
  });

  test("venue priced near consensus produces no directional hit", () => {
    const patterns = detectValuePatterns(events, [
      { eventId, venue: "polymarket", side: "Alpha", implied: 0.64 },
    ]);
    expect(patterns.some((p) => p.kind === "venue_undervalued" || p.kind === "venue_overvalued")).toBe(false);
  });

  test("venue priced above consensus is flagged venue_overvalued", () => {
    const patterns = detectValuePatterns(events, [
      { eventId, venue: "kalshi", side: "Beta", implied: 0.45 },
    ]);
    // Beta consensus ≈ 35%; venue 45% = overvalued
    const hit = patterns.find((p) => p.kind === "venue_overvalued");
    expect(hit).toBeDefined();
  });

  test("thin consensus is flagged regardless of gap", () => {
    const single = `<odds-heat><cluster venue="only" commence="2026-03-01T19:00:00Z"><home team="A"/><away team="B"/><print name="A" american="-120"/><print name="B" american="+100"/></cluster></odds-heat>`;
    const one = parseOddsXmlEvents(single, { sportKey: "soccer_epl", market: "h2h", commenceTime: "2026-03-01T19:00:00Z" });
    const patterns = detectValuePatterns(one, [
      { eventId: one[0]!.id, venue: "kalshi", side: "A", implied: 0.3 },
    ]);
    expect(patterns.some((p) => p.kind === "thin_consensus")).toBe(true);
    expect(patterns.some((p) => p.kind === "venue_undervalued")).toBe(false);
  });

  test("wide bookmaker spread is flagged", () => {
    const wide = `<odds-heat>`
      + `<cluster venue="a" commence="2026-03-01T19:00:00Z"><home team="A"/><away team="B"/><print name="A" american="-500"/><print name="B" american="+400"/></cluster>`
      + `<cluster venue="b" commence="2026-03-01T19:00:00Z"><home team="A"/><away team="B"/><print name="A" american="-110"/><print name="B" american="-110"/></cluster>`
      + `</odds-heat>`;
    const w = parseOddsXmlEvents(wide, { sportKey: "soccer_epl", market: "h2h", commenceTime: "2026-03-01T19:00:00Z" });
    const patterns = detectValuePatterns(w, [
      { eventId: w[0]!.id, venue: "kalshi", side: "A", implied: 0.6 },
    ]);
    expect(patterns.some((p) => p.kind === "wide_spread")).toBe(true);
    expect(patterns.some((p) => p.kind === "venue_undervalued")).toBe(false); // spread gate blocks the gap
  });

  test("kalshiCentsToImplied clamps to 0..1", () => {
    expect(kalshiCentsToImplied(45)).toBeCloseTo(0.45, 5);
    expect(kalshiCentsToImplied(0)).toBe(0);
    expect(kalshiCentsToImplied(100)).toBe(1);
    expect(kalshiCentsToImplied(150)).toBe(1);
  });
});

