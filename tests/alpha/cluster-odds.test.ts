// End-to-end: odds prints -> cluster vectors -> labels; consensus shifts on merge/split.
// Deterministic fixtures (seeded jitter), §193.
import { describe, expect, test } from "bun:test";
import { clusterOddsPrints, type OddsPrint } from "../../src/alpha/cluster/odds-vector.ts";
import { detectShifts } from "../../src/alpha/cluster/consensus.ts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function pocketPrints(source: string, implied: number, vig: number, n: number, seed: number, ts: number): OddsPrint[] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, (_u, i) => ({
    id: `${source}:${i}:yes`,
    source,
    eventId: `${source}-${i}`,
    side: "yes",
    implied: implied + (rnd() - 0.5) * 0.01,
    vig: vig + (rnd() - 0.5) * 0.001, // per-pocket vig reinforces the separation
    ts,
  }));
}

describe("clusterOddsPrints", () => {
  test("three distinct implied-prob pockets cluster into three groups", () => {
    const prints = [
      ...pocketPrints("kalshi", 0.30, 0.030, 8, 1, 1000),
      ...pocketPrints("pinnacle", 0.55, 0.040, 8, 2, 1000),
      ...pocketPrints("betfair", 0.80, 0.050, 8, 3, 1000),
    ];
    const res = clusterOddsPrints(prints, { minClusterSize: 3 });
    const labelCount = new Set(res.labels.filter((l) => l !== -1)).size;
    expect(labelCount).toBeGreaterThanOrEqual(2);
    expect(res.noiseCount).toBeLessThan(prints.length);
  });

  test("deterministic: same prints -> same labels", () => {
    const prints = pocketPrints("kalshi", 0.5, 0.04, 10, 5, 1000);
    const a = clusterOddsPrints(prints);
    const b = clusterOddsPrints(prints);
    expect(a.labels).toEqual(b.labels);
  });
});

describe("detectShifts", () => {
  test("a merge (two prev clusters -> one next cluster) is detected", () => {
    const prev = { ts: 1000, labels: { a: 0, b: 0, c: 1, d: 1, e: -1 } };
    const next = { ts: 2000, labels: { a: 0, b: 0, c: 0, d: 0, e: -1 } };
    const shifts = detectShifts(prev, next);
    expect(shifts.some((s) => s.kind === "merge" && s.fromLabels.includes(0) && s.fromLabels.includes(1))).toBe(true);
  });

  test("a split (one prev cluster -> two next clusters) is detected", () => {
    const prev = { ts: 1000, labels: { a: 0, b: 0, c: 0, d: 0 } };
    const next = { ts: 2000, labels: { a: 0, b: 0, c: 1, d: 1 } };
    const shifts = detectShifts(prev, next);
    expect(shifts.some((s) => s.kind === "split" && s.fromLabels.includes(0))).toBe(true);
  });

  test("no shifts when labels are stable", () => {
    const prev = { ts: 1000, labels: { a: 0, b: 0, c: 1 } };
    const next = { ts: 2000, labels: { a: 0, b: 0, c: 1 } };
    expect(detectShifts(prev, next)).toEqual([]);
  });
});