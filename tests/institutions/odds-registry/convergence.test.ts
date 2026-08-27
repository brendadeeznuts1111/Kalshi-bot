/**
 * convergence tests: spread tightening/widening + stale + snapshot builder.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyConvergence,
  consensusSnapshot,
  parseOddsXmlEvents,
} from "../../../src/institutions/odds-registry/index.ts";

const now = Date.now();

describe("classifyConvergence", () => {
  test("tightened spread -> converging", () => {
    const p = classifyConvergence("e1", "Alpha",
      { ts: now, consensus: 0.6, spread: 0.02, bookmakers: 4 },
      { ts: now - 60_000, consensus: 0.59, spread: 0.08, bookmakers: 4 });
    expect(p?.kind).toBe("converging");
    expect(p?.note).toContain("tightened");
  });

  test("widened spread -> diverging", () => {
    const p = classifyConvergence("e1", "Alpha",
      { ts: now, consensus: 0.6, spread: 0.09, bookmakers: 4 },
      { ts: now - 60_000, consensus: 0.6, spread: 0.03, bookmakers: 4 });
    expect(p?.kind).toBe("diverging");
    expect(p?.note).toContain("widened");
  });

  test("old quote -> stale (regardless of spread)", () => {
    const p = classifyConvergence("e1", "Alpha",
      { ts: now - 10 * 60_000, consensus: 0.6, spread: 0.02, bookmakers: 4 },
      { ts: now - 11 * 60_000, consensus: 0.6, spread: 0.08, bookmakers: 4 });
    expect(p?.kind).toBe("stale");
  });

  test("stable spread -> no pattern", () => {
    const p = classifyConvergence("e1", "Alpha",
      { ts: now, consensus: 0.6, spread: 0.05, bookmakers: 4 },
      { ts: now - 60_000, consensus: 0.6, spread: 0.05, bookmakers: 4 });
    expect(p).toBeNull();
  });

  test("fewer than 2 bookmakers in either snapshot -> null", () => {
    const p = classifyConvergence("e1", "Alpha",
      { ts: now, consensus: 0.6, spread: 0, bookmakers: 1 },
      { ts: now - 60_000, consensus: 0.6, spread: 0.08, bookmakers: 4 });
    expect(p).toBeNull();
  });
});

describe("consensusSnapshot", () => {
  const FEED = `<odds-heat>`
    + `<cluster venue="a" commence="2026-09-01T19:00:00Z"><home team="A"/><away team="B"/>`
    + `<print name="A" american="-200"/><print name="B" american="+150"/></cluster>`
    + `<cluster venue="b" commence="2026-09-01T19:00:00Z"><home team="A"/><away team="B"/>`
    + `<print name="A" american="-190"/><print name="B" american="+160"/></cluster>`
    + `</odds-heat>`;
  const events = parseOddsXmlEvents(FEED, { sportKey: "tennis_atp", market: "h2h", commenceTime: 1772391600000 });

  test("builds mean/spread/count for a side", () => {
    const s = consensusSnapshot(events, events[0]!.id, "A");
    expect(s).not.toBeNull();
    expect(s!.bookmakers).toBe(2);
    expect(s!.consensus).toBeGreaterThan(0.6);
    expect(s!.consensus).toBeLessThan(0.67);
    expect(s!.spread).toBeGreaterThan(0);
    expect(s!.ts).toBeGreaterThan(0);
  });

  test("null for a side no bookmaker quotes", () => {
    const s = consensusSnapshot(events, events[0]!.id, "Nobody");
    expect(s).toBeNull();
  });
});

