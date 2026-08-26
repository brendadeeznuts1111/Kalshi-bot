// Heap-based odds consensus wired into the alpha signal pipeline (§193).
import { describe, expect, test } from "bun:test";
import { americanToImplied, eventsToOddsPrints, buildOddsConsensus } from "../../src/alpha/signal-context.ts";
import type { OddsEvent } from "../../src/alpha/odds-types.ts";

function ev(id: string, home: string, away: string, bkPrice: Array<[string, number, number]>): OddsEvent {
  return {
    id: id as any,
    sportKey: "tennis",
    commenceTime: "2026-08-26T12:00:00Z",
    homeTeam: home,
    awayTeam: away,
    bookmakers: bkPrice.map(([key, homeP, awayP]) => ({ key, title: key, lastUpdate: "", markets: [{ key: "h2h", outcomes: [{ name: home, price: homeP }, { name: away, price: awayP }] }] })),
  };
}

describe("americanToImplied", () => {
  test("positive and negative American odds convert correctly", () => {
    expect(americanToImplied(100)).toBeCloseTo(0.5, 5);
    expect(americanToImplied(-100)).toBeCloseTo(0.5, 5);
    expect(americanToImplied(300)).toBeCloseTo(0.25, 5);
    expect(americanToImplied(-300)).toBeCloseTo(0.75, 5);
  });
});

describe("eventsToOddsPrints", () => {
  test("derives one print per outcome per bookmaker, normalized implied + vig", () => {
    const events = [ev("e1", "A", "B", [["kalshi", 100, -130], ["pinnacle", 110, -130]])];
    const prints = eventsToOddsPrints(events);
    expect(prints).toHaveLength(4);
    // each market: implieds sum to 1 (normalized), vig = overround - 1
    const kalshi = prints.filter((x) => x.source === "kalshi");
    expect(kalshi[0]!.implied + kalshi[1]!.implied).toBeCloseTo(1, 5);
    expect(kalshi[0]!.vig).toBeGreaterThan(0);
    expect(kalshi[0]!.id).toBe("kalshi:e1:A");
  });
});

describe("buildOddsConsensus", () => {
  test("clusters distinct source pockets; null for <2 prints", () => {
    const events = [ev("e1", "A", "B", [["kalshi", 100, -100], ["pinnacle", 100, -100]]), ev("e2", "C", "D", [["betfair", 300, -500]])];
    const c = buildOddsConsensus(events);
    expect(c).not.toBeNull();
    expect(c!.clusters).toBeGreaterThanOrEqual(1);
    expect(c!.prints).toBe(6);
    expect(buildOddsConsensus([])).toBeNull();
    expect(buildOddsConsensus([ev("e1", "A", "B", [])])).toBeNull(); // no bookmakers - 0 prints
  });
});