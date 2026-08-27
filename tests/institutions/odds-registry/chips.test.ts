/**
 * chips tests — ANSI odds-heat chips. paint() auto-TTY behavior varies by
 * harness (this one colors even without a TTY — see the ansi-width notes),
 * so every assertion runs on Bun.stripANSI output: these verify structure
 * and content, never escape bytes.
 */
import { describe, expect, test } from "bun:test";
import type { OddsEvent } from "../../../src/alpha/odds-types.ts";
import {
  collisionChip,
  kickoffChip,
  renderOddsEventLine,
  renderOddsReportAnsi,
  styledRGB,
  tempToRGB,
  venueChip,
  weatherChip,
  weatherIcon,
} from "../../../src/institutions/odds-registry/chips.ts";
import {
  parseOddsXmlEvents,
  venueKeyFor,
  type VenueStore,
} from "../../../src/institutions/odds-registry/index.ts";

const plain = (s: string) => Bun.stripANSI(s);

const STORE: VenueStore = {
  schema: "odds-venues/v1",
  venues: [{
    venueKey: "v:51.5074:-0.1278",
    name: "Alpha Park",
    city: "London",
    timezone: "Europe/London",
  }],
};

const LOC = { lat: 51.5074, long: -0.1278 };

const mkEvent = (over: Partial<OddsEvent> = {}): OddsEvent => ({
  id: "alpha-fc-vs-beta-fc-2026-09-01" as never,
  sportKey: "soccer_epl",
  commenceTime: "2026-09-01T19:00:00Z",
  homeTeam: "Alpha FC",
  awayTeam: "Beta FC",
  location: LOC,
  bookmakers: [],
  ...over,
});

describe("weatherChip", () => {
  test("icon + rounded temp + wind, one compact chip", () => {
    const chip = plain(weatherChip({ temperatureC: 22.4, condition: "Clear", windSpeedKmh: 15.6 }));
    expect(chip).toContain("☀");
    expect(chip).toContain("22.4°C");
    expect(chip).toContain("wind 16 km/h");
  });

  test("icon buckets follow the report conditions", () => {
    expect(weatherIcon("Clear")).toBe("☀");
    expect(weatherIcon("Rain")).toBe("🌧");
    expect(weatherIcon("Snow")).toBe("❄");
    expect(weatherIcon(undefined)).toBe("◌");
  });

  test("no weather -> empty chip (segments collapse away)", () => {
    expect(weatherChip(undefined)).toBe("");
    expect(weatherChip({})).toBe("");
  });
});

describe("venueChip", () => {
  test("store identity wins; coords fallback; empty without location", () => {
    expect(plain(venueChip(LOC, STORE))).toContain("⌖ Alpha Park, London");
    expect(plain(venueChip(LOC, undefined))).toContain("51.5074, -0.1278");
    expect(venueChip(undefined, STORE)).toBe("");
  });

  test("long names truncate at visible width with ellipsis", () => {
    const long: VenueStore = {
      schema: "odds-venues/v1",
      venues: [{ venueKey: venueKeyFor({ lat: 1, long: 1 }), name: "Ultra Mega Super Long Stadium Name", city: "Somewhere" }],
    };
    const chip = plain(venueChip({ lat: 1, long: 1 }, long));
    expect(chip).toContain("…");
    expect(Bun.stringWidth(chip)).toBeLessThan(60);
  });
});

describe("tempToRGB / styledRGB (gradient)", () => {
  test("gradient endpoints: deep cold blue -> hot red, clamped", () => {
    expect(tempToRGB(-20)).toEqual([0, 100, 255]);
    expect(tempToRGB(-25)).toEqual([0, 100, 255]); // clamped
    expect(tempToRGB(40)).toEqual([255, 45, 0]);
    expect(tempToRGB(50)).toEqual([255, 45, 0]); // clamped
    // midranges interpolate, never out of gamut
    for (const t of [-3, 8, 22, 35]) {
      const [r, g, b] = tempToRGB(t);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  test("styledRGB emits a 24-bit escape (or plain under NO_COLOR bootstrap)", () => {
    const out = styledRGB("22°C", tempToRGB(22));
    // Either the truecolor escape wraps the text or NO_COLOR stripped it —
    // both are correct; a garbage half-styled string is not.
    expect(Bun.stripANSI(out)).toBe("22°C");
    expect(out === "22°C" || out.startsWith("\x1b[38;2;")).toBe(true);
  });
});

describe("collisionChip", () => {
  test("silent for 0/1, badge above 1", () => {
    expect(collisionChip(0)).toBe("");
    expect(collisionChip(1)).toBe("");
    expect(plain(collisionChip(2))).toContain("2 events");
    expect(plain(collisionChip(7))).toContain("7 events");
  });
});

describe("kickoffChip", () => {
  test("venue-local time; placeholder times collapse away", () => {
    expect(plain(kickoffChip("2026-09-01T19:00:00Z", "Europe/London"))).toContain("1 Sep 2026 at 20:00");
    expect(kickoffChip("0")).toBe("");
    expect(kickoffChip("")).toBe("");
  });
});

describe("renderOddsEventLine / renderOddsReportAnsi", () => {
  test("line joins segments; missing pieces collapse (no dash rows)", () => {
    const line = plain(renderOddsEventLine(mkEvent(), { venueStore: STORE }));
    expect(line).toContain("Alpha FC vs Beta FC");
    expect(line).toContain("⌖ Alpha Park, London");
    expect(line).toContain("◷ 1 Sep 2026 at 20:00");
    // No weather -> no empty segment separators.
    expect(line).not.toContain("· ·");
  });

  test("collision chip is feed-wide in the report block", () => {
    const events = [mkEvent(), mkEvent({ id: "gamma-fc-vs-beta-fc-2026-09-01" as never, homeTeam: "Gamma FC" })];
    const block = plain(renderOddsReportAnsi(events, { venueStore: STORE }));
    expect(block).toContain("Odds Heat — 2 event(s)");
    expect(block).toContain("⟨2 events⟩");
    // Single-event context has no collision chip on the bare line.
    expect(plain(renderOddsEventLine(mkEvent(), { venueStore: STORE }))).not.toContain("events⟩");
  });

  test("weather chip rides the line when the event carries a forecast", () => {
    const line = plain(renderOddsEventLine(
      mkEvent({ weather: { temperatureC: -3, condition: "Snow" } }),
      { venueStore: STORE },
    ));
    expect(line).toContain("❄ -3°C Snow");
  });
});
