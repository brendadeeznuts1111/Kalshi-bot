// LiveConsensusStream: repeated-snapshot consumer of ConsensusTracker (§193 live wiring).
import { describe, expect, test } from "bun:test";
import { LiveConsensusStream } from "../../src/alpha/cluster/live-consensus.ts";
import type { OddsPrint } from "../../src/alpha/cluster/odds-vector.ts";
import type { OddsEvent } from "../../src/alpha/odds-types.ts";

function printsAt(implieds: number[], ts: number): OddsPrint[] {
  return implieds.map((imp, i) => ({
    id: "p" + i, source: "s" + (i % 3), eventId: "e" + i, side: "yes",
    implied: imp, vig: 0.04, ts,
  }));
}

function eventsAt(prices: Array<[string, number, number]>, ts: string): OddsEvent[] {
  return [{
    id: "e1" as any,
    sportKey: "tennis",
    commenceTime: ts,
    homeTeam: "A",
    awayTeam: "B",
    bookmakers: prices.map(([key, homeP, awayP]) => ({ key, title: key, lastUpdate: "", markets: [{ key: "h2h", outcomes: [{ name: "A", price: homeP }, { name: "B", price: awayP }] }] })),
  }];
}

describe("LiveConsensusStream", () => {
  test("first snapshot no shifts; second with a move emits merge (beyond the CLI demo)", () => {
    const s = new LiveConsensusStream();
    const s1 = s.observe(printsAt([0.30, 0.31, 0.32, 0.33, 0.70, 0.71, 0.72, 0.73], 1000), 1000);
    expect(s1).not.toBeNull();
    expect(s1!.shifts).toEqual([]);
    expect(s.tickCount).toBe(1);
    const s2 = s.observe(printsAt([0.48, 0.49, 0.50, 0.51, 0.52, 0.53, 0.54, 0.55], 2000), 2000);
    expect(s2!.shifts.some((x) => x.kind === "merge")).toBe(true);
    expect(s.tickCount).toBe(2);
    expect(s.shiftHistory.length).toBeGreaterThan(0);
  });

  test("shift history is bounded to windowSize", () => {
    const s = new LiveConsensusStream({ windowSize: 2 });
    s.observe(printsAt([0.3, 0.31, 0.32, 0.33, 0.7, 0.71, 0.72, 0.73], 1000), 1000);
    s.observe(printsAt([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 2000), 2000); // merge
    s.observe(printsAt([0.3, 0.31, 0.32, 0.33, 0.7, 0.71, 0.72, 0.73], 3000), 3000); // split
    expect(s.shiftHistory.length).toBeLessThanOrEqual(2);
  });

  test("observeEvents converts The Odds API wire shape through eventsToOddsPrints", () => {
    const s = new LiveConsensusStream();
    const snap = s.observeEvents(eventsAt([["kalshi", 100, -130], ["pinnacle", 110, -130]], "2026-08-26T12:00:00Z"), 5000);
    expect(snap).not.toBeNull();
    expect(snap!.prints.length).toBe(4); // 2 bookmakers x 2 outcomes
  });

  test("fewer than 2 prints -> null, no tick", () => {
    const s = new LiveConsensusStream();
    expect(s.observe([], 1000)).toBeNull();
    expect(s.observe([printsAt([0.5], 1000)[0]!], 1000)).toBeNull();
    expect(s.tickCount).toBe(0);
  });

  test("reset clears history and ticks", () => {
    const s = new LiveConsensusStream();
    s.observe(printsAt([0.3, 0.7], 1000), 1000);
    s.observe(printsAt([0.5, 0.5], 2000), 2000);
    expect(s.tickCount).toBe(2);
    s.reset();
    expect(s.tickCount).toBe(0);
    expect(s.shiftHistory).toEqual([]);
    const n = s.observe(printsAt([0.3, 0.7], 3000), 3000);
    expect(n!.shifts).toEqual([]);
  });
});
