// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { computeMetrics, evaluateProgram } from "../../src/calibration/watcher.ts";
import { verifyHashChain, type ShadowLine } from "../../src/institutions/shadow-line.ts";
import type { ProgramManifest } from "../../src/institutions/program-manifest.ts";

function manifest(overrides: Partial<ProgramManifest> = {}): ProgramManifest {
  return {
    name: "test-prog",
    dimension: "sports-soccer",
    status: "shadow",
    baseline: "pinnacle-novig",
    created: "2026-07-22",
    shadowLog: "shadow-log.jsonl",
    hypothesisFile: "hypothesis.md",
    minContracts: 5,
    gates: {
      shadowMinSignals: 100,
      shadowMinWeeks: 3,
      pilotMaxContracts: 5,
      killBrierDriftPct: 15,
      graduationMinRealizedEdgeCentsPerFill: 2,
      graduationMinFills: 30,
    },
    ...overrides,
  };
}

function line(partial: Partial<ShadowLine> & Pick<ShadowLine, "lineHash" | "prevHash">): ShadowLine {
  return {
    ts: partial.ts ?? Date.now(),
    program: "test-prog",
    ticker: "KXTEST",
    eventId: "evt-1",
    pModel: 0.6,
    components: { pinnacle_novig: 0.6 },
    book: { ts: 1, bids: [], asks: [{ priceCents: 50, size: 100 }], seq: 1 },
    decision: { action: "skip", reason: "insufficient edge after fees" },
    rawEdgeCents: 10,
    feePerContractCents: 2,
    vwapFillCents: null,
    filledContracts: 0,
    midAtFillCents: 50,
    toxicity: { dueTs: 0, markedTs: null, midCents: null, movedAgainst: null },
    outcome: null,
    ...partial,
  };
}

function tradeLine(
  i: number,
  prev: string,
  overrides: Partial<ShadowLine> = {},
): ShadowLine {
  return line({
    prevHash: prev,
    lineHash: `h${i}`,
    ts: Date.now() - (100 - i) * 86400000,
    outcome: 1,
    pModel: 0.55,
    vwapFillCents: 50,
    filledContracts: 5,
    feePerContractCents: 2,
    components: { pinnacle_novig_home: 0.55, pinnacle_novig_away: 0.45 },
    decision: { action: "trade", side: "yes", contracts: 5, reason: "edge" },
    ...overrides,
  });
}

describe("calibration watcher", () => {
  test("verifyHashChain rejects mismatched lineHash", () => {
    expect(verifyHashChain([line({ prevHash: "0", lineHash: "not-valid" })])).toBe(false);
  });

  test("kill recommendation when Brier drifts past pre-committed gate", () => {
    const now = Date.now();
    const resolved: ShadowLine[] = [];
    for (let i = 0; i < 100; i++) {
      resolved.push(
        line({
          prevHash: i === 0 ? "0" : `h${i - 1}`,
          lineHash: `h${i}`,
          ts: now - (100 - i) * 86400000,
          outcome: 1,
          pModel: 0.9,
          decision: { action: "trade", side: "yes", contracts: 5, reason: "edge" },
          filledContracts: 5,
          vwapFillCents: 50,
        }),
      );
    }
    const good = computeMetrics(resolved, 0.25);
    expect(good.brier).toBeCloseTo(0.01, 2);
    expect(evaluateProgram(manifest(), good).some((a) => a.kind === "kill-recommendation")).toBe(
      false,
    );

    const bad = computeMetrics(
      resolved.map((l) => ({ ...l, pModel: 0.1 })),
      0.25,
    );
    expect(bad.brier).toBeGreaterThan(0.25 * 1.15);
    expect(
      evaluateProgram(manifest(), bad).some((a) => a.kind === "kill-recommendation"),
    ).toBe(true);
  });

  test("graduation requires realized edge after fees, not Brier alone", () => {
    const fills: ShadowLine[] = [];
    for (let i = 0; i < 100; i++) {
      fills.push(tradeLine(i, i === 0 ? "0" : `h${i - 1}`));
    }
    const goodEdge = {
      ...computeMetrics(fills, 0.25),
      hashChainValid: true,
      spanWeeks: 4,
    };
    expect(goodEdge.meanRealizedEdgeCentsPerFill).toBeGreaterThan(2);
    expect(
      evaluateProgram(manifest(), goodEdge).some((a) => a.kind === "graduation-proposal"),
    ).toBe(true);

    const badEdge = {
      ...computeMetrics(
        fills.map((l) => ({ ...l, vwapFillCents: 58, feePerContractCents: 2 })),
        0.25,
      ),
      hashChainValid: true,
      spanWeeks: 4,
    };
    expect(badEdge.meanRealizedEdgeCentsPerFill!).toBeLessThan(2);
    expect(
      evaluateProgram(manifest(), badEdge).some((a) => a.kind === "graduation-proposal"),
    ).toBe(false);
  });

  test("skip reasons aggregate in metrics", () => {
    const m = computeMetrics([
      line({ prevHash: "0", lineHash: "1", decision: { action: "skip", reason: "book too thin" } }),
      line({ prevHash: "1", lineHash: "2", decision: { action: "skip", reason: "book too thin" } }),
    ]);
    expect(m.skipReasons["book too thin"]).toBe(2);
  });

  test("graduation blocked while stub baseline active", () => {
    const fills: ShadowLine[] = [];
    for (let i = 0; i < 100; i++) {
      fills.push(tradeLine(i, i === 0 ? "0" : `h${i - 1}`));
    }
    const metrics = {
      ...computeMetrics(fills.map((l) => ({ ...l, outcome: null }))),
      hashChainValid: true,
      spanWeeks: 4,
      fillCount: 30,
      meanRealizedEdgeCentsPerFill: 5,
      brier: 0.2,
      resolvedLines: 100,
      empiricalBaselineBrier: null,
      baselineBrier: 0.25,
    };
    const artifacts = evaluateProgram(manifest(), metrics);
    expect(artifacts.some((a) => a.kind === "graduation-proposal")).toBe(false);
    expect(artifacts[0]?.evidence.graduationBlocked).toContain("stub baseline");
  });

  test("baseline program never receives graduation proposal", () => {
    const metrics = {
      ...computeMetrics([tradeLine(0, "0", { outcome: 1 })]),
      hashChainValid: true,
      spanWeeks: 4,
      fillCount: 30,
      meanRealizedEdgeCentsPerFill: 5,
      brier: 0.2,
      resolvedLines: 100,
    };
    const artifacts = evaluateProgram(manifest({ role: "baseline", name: "pinnacle-novig-nba" }), metrics);
    expect(artifacts.some((a) => a.kind === "graduation-proposal")).toBe(false);
  });

  test("empirical baseline Brier uses pinnacle components not 0.25 placeholder", () => {
    const resolved = line({
      prevHash: "0",
      lineHash: "1",
      outcome: 1,
      pModel: 0.58,
      components: { pinnacle_novig_home: 0.52, pinnacle_novig_away: 0.48 },
      decision: { action: "trade", side: "yes", contracts: 5, reason: "edge" },
    });
    const m = computeMetrics([resolved]);
    expect(m.empiricalBaselineBrier).not.toBeNull();
    const empirical = m.empiricalBaselineBrier as number;
    expect(empirical).toBeCloseTo((0.52 - 1) ** 2, 4);
    expect(m.baselineBrier).toBe(empirical);
  });
});
