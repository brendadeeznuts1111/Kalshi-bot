// Cluster metadata helpers (S214 proposal's Cluster getters, production home in odds-vector).
import { describe, expect, test } from "bun:test";
import { clusterMetadata, type OddsPrint } from "../../src/alpha/cluster/odds-vector.ts";

function prints(implieds: number[]): OddsPrint[] {
  return implieds.map((imp, i) => ({ id: "p" + i, source: "s", eventId: "e" + i, side: "yes", implied: imp, vig: 0.04, ts: 1000 }));
}

describe("clusterMetadata", () => {
  test("consensus = mean implied, spread = max-min, tightness = 1 - spread/12", () => {
    const m = clusterMetadata(prints([0.3, 0.4, 0.5]));
    expect(m.consensus).toBeCloseTo(0.4, 5);
    expect(m.spread).toBeCloseTo(0.2, 5);
    expect(m.tightness).toBeCloseTo(1 - 0.2 / 12, 5);
    expect(m.prints).toBe(3);
  });

  test("single print: consensus = value, spread 0, tightness 1", () => {
    const m = clusterMetadata(prints([0.7]));
    expect(m.consensus).toBeCloseTo(0.7, 5);
    expect(m.spread).toBe(0);
    expect(m.tightness).toBe(1);
  });

  test("empty cluster -> null metadata", () => {
    const m = clusterMetadata([]);
    expect(m).toEqual({ consensus: null, spread: null, tightness: null, prints: 0 });
  });
});
