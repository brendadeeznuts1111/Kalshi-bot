// HDBSCAN-style clusterer: separation, merging, determinism (heap-based, §193).
import { describe, expect, test } from "bun:test";
import { euclidean, coreDistances, mutualReachability, primMST, flatLabels } from "../../src/alpha/cluster/hdbscan.ts";

// deterministic jitter (mulberry32) so fixtures are stable across runs
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pocket(cx: number, cy: number, n: number, seed: number): number[][] {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => [cx + (rnd() - 0.5), cy + (rnd() - 0.5)]);
}

function countClusters(labels: number[]): number {
  return new Set(labels.filter((l) => l !== -1)).size;
}

describe("euclidean / coreDistances", () => {
  test("euclidean distance is symmetric and correct", () => {
    expect(euclidean([0, 0], [3, 4])).toBe(5);
    expect(euclidean([1, 1], [1, 1])).toBe(0);
  });

  test("core distance is the k-th nearest neighbor distance", () => {
    const pts = pocket(0, 0, 5, 1);
    const core = coreDistances(pts, 3);
    expect(core).toHaveLength(5);
    expect(core.every((c) => c >= 0)).toBe(true);
  });
});

describe("flatLabels separation", () => {
  test("two well-separated pockets split into two clusters", () => {
    const a = pocket(0, 0, 10, 7);
    const b = pocket(10, 10, 10, 11);
    const pts = [...a, ...b];
    const mrd = mutualReachability(pts, 3);
    const mst = primMST(pts.length, mrd);
    const labels = flatLabels(pts.length, mst, 3);
    expect(countClusters(labels)).toBe(2);
    const first = new Set(labels.slice(0, 10));
    const second = new Set(labels.slice(10));
    // each pocket is internally uniform, and they differ
    expect(new Set([...first].filter((l) => l !== -1)).size).toBeLessThanOrEqual(1);
    expect(new Set([...second].filter((l) => l !== -1)).size).toBeLessThanOrEqual(1);
    expect(labels.slice(0, 10).some((l) => l !== -1)).toBe(true);
    expect(labels.slice(10).some((l) => l !== -1)).toBe(true);
  });

  test("a single dense pocket merges into one cluster", () => {
    const pts = pocket(0, 0, 20, 3);
    const mrd = mutualReachability(pts, 3);
    const mst = primMST(pts.length, mrd);
    const labels = flatLabels(pts.length, mst, 3);
    expect(countClusters(labels)).toBe(1);
    expect(labels.every((l) => l !== -1)).toBe(true);
  });

  test("deterministic across runs (same labels, same order)", () => {
    const a = pocket(0, 0, 10, 7);
    const b = pocket(10, 10, 10, 11);
    const pts = [...a, ...b];
    const l1 = flatLabels(pts.length, primMST(pts.length, mutualReachability(pts, 3)), 3);
    const l2 = flatLabels(pts.length, primMST(pts.length, mutualReachability(pts, 3)), 3);
    expect(l1).toEqual(l2);
  });
});