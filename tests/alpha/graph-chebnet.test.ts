import { describe, expect, test } from "bun:test";
import {
  chebyshevBlocks,
  csrFromEdges,
  spmv,
} from "../../alpha/tennis-graph-chebnet/src/chebyshev.ts";
import {
  buildPlayerGraph,
  edgesFromMatches,
  nodeFeatures,
  splitByTime,
  NODE_FEATURES,
  type EventRow,
} from "../../alpha/tennis-graph-chebnet/src/graph.ts";
import { trainGraphModel } from "../../alpha/tennis-graph-chebnet/src/train.ts";

// Path graph 0—1—2—3, unit weights
const g = csrFromEdges(4, [
  { a: 0, b: 1, w: 1 },
  { a: 1, b: 2, w: 1 },
  { a: 2, b: 3, w: 1 },
]);

describe("chebyshev", () => {
  test("spmv computes normalized adjacency product", () => {
    const x = new Float64Array([1, 0, 0, 0]);
    const y = new Float64Array(4);
    spmv(g, x, y);
    expect(y[0]).toBe(0);
    expect(y[1]).toBeCloseTo(1 / Math.sqrt(2), 6); // A_norm[1][0]
    expect(y[2]).toBe(0);
  });

  test("T0 = x, T1 = −A_norm·x", () => {
    const x = new Float64Array([1, 2, 3, 4]);
    const [t0, t1] = chebyshevBlocks(g, x, 1);
    expect([...t0!]).toEqual([1, 2, 3, 4]);
    const ax = new Float64Array(4);
    spmv(g, x, ax);
    for (let i = 0; i < 4; i++) expect(t1![i]).toBeCloseTo(-ax[i]!, 10);
  });

  test("recurrence T2 = 2L̃T1 − T0", () => {
    const x = new Float64Array([1, 0, 1, 0]);
    const blocks = chebyshevBlocks(g, x, 2);
    const t1 = blocks[1]!;
    const ax = new Float64Array(4);
    spmv(g, t1, ax);
    for (let i = 0; i < 4; i++) {
      expect(blocks[2]![i]).toBeCloseTo(-2 * ax[i]! - x[i]!, 10);
    }
  });
});

const ROWS: EventRow[] = [
  // chain: A beats B, B beats C, C beats A (intransitivity), A beats D
  { eventId: "e1", playerA: "A", playerB: "B", winner: "A", loser: "B", startTs: "2026-07-01T00:00:00Z", tournament: "M25 Testville" },
  { eventId: "e2", playerA: "B", playerB: "C", winner: "B", loser: "C", startTs: "2026-07-02T00:00:00Z", tournament: "M25 Testville" },
  { eventId: "e3", playerA: "C", playerB: "A", winner: "C", loser: "A", startTs: "2026-07-03T00:00:00Z", tournament: "M25 Testville" },
  { eventId: "e4", playerA: "A", playerB: "D", winner: "A", loser: "D", startTs: "2026-07-20T00:00:00Z", tournament: "M25 Testville" },
  // excluded: unknown nationality
  { eventId: "e5", playerA: "Zzz Unknown", playerB: "A", winner: "A", loser: "Zzz Unknown", startTs: "2026-07-04T00:00:00Z", tournament: "M25 Testville" },
];

describe("graph builder", () => {
  test("gates on Enrichment Lock and keeps directed labels", () => {
    // NOTE: fixture players aren't in any seed — all should be excluded
    const built = buildPlayerGraph(ROWS);
    expect(built.matches.length).toBe(0);
    expect(built.excluded.nationality).toBe(5);
  });

  test("time split and train-only edges", () => {
    const matches = [
      { winner: 0, loser: 1, tsMs: 100 },
      { winner: 1, loser: 2, tsMs: 200 },
      { winner: 2, loser: 0, tsMs: 300 },
    ];
    const edges = edgesFromMatches(matches.slice(0, 2));
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.a === 0 && e.b === 2)).toBeUndefined();
  });

  test("node features respect the cutoff (no leakage)", () => {
    const built = {
      players: ["A", "B"],
      playerIdx: new Map([["A", 0], ["B", 1]]),
      edges: [],
      matches: [
        { winner: 0, loser: 1, tsMs: 100 },
        { winner: 1, loser: 0, tsMs: 200 },
      ],
      excluded: { nationality: 0, tier: 0, country: 0 },
    };
    const X = nodeFeatures(built, 150);
    // before cutoff only A beat B — Bayesian-smoothed: (1+2)/(1+4) − 0.5 = 0.1
    expect(X[0 * NODE_FEATURES]).toBeCloseTo(0.1, 6);
    expect(X[1 * NODE_FEATURES]).toBeCloseTo(-0.1, 6);
    const Xall = nodeFeatures(built, 250);
    expect(Xall[0 * NODE_FEATURES]).toBeCloseTo(0, 6); // 1–1 → smoothed 0.5 − 0.5
  });
});

describe("trainGraphModel", () => {
  test("learns a separable pattern", () => {
    // strong players always beat weak ones; enough matches to fit
    const matches: Array<{ winner: number; loser: number; tsMs: number }> = [];
    for (let t = 0; t < 60; t++) {
      matches.push({ winner: t % 5, loser: 5 + (t % 5), tsMs: t });
      matches.push({ winner: t % 5, loser: 5 + ((t + 1) % 5), tsMs: t });
    }
    const built = {
      players: Array.from({ length: 10 }, (_, i) => "P" + i),
      playerIdx: new Map(Array.from({ length: 10 }, (_, i) => ["P" + i, i])),
      edges: [],
      matches,
      excluded: { nationality: 0, tier: 0, country: 0 },
    };
    const model = trainGraphModel(built, { K: 2, cutoffMs: 42, epochs: 400, lr: 0.1 });
    expect(model.trainStats.accuracy).toBeGreaterThan(0.8);
    expect(model.validStats.n).toBeGreaterThan(0);
    expect(model.validStats.accuracy).toBeGreaterThan(0.7);
    expect(model.weights).toHaveLength(3); // K+1 blocks
  });
});
