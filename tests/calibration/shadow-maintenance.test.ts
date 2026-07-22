// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../../src/research/paths.ts";
import {
  applyOutcomes,
  applyToxicityMark,
  markDueToxicity,
  recomputeHashChain,
  verifyHashChain,
  type ShadowLine,
} from "../../src/institutions/shadow-line.ts";
import { runToxicityMark, runOutcomeResolution } from "../../src/calibration/shadow-maintenance.ts";

function tradeLine(partial: Partial<ShadowLine> = {}): ShadowLine {
  return {
    prevHash: "0",
    lineHash: "x",
    ts: Date.now() - 120_000,
    program: "test",
    ticker: "KXTEST",
    eventId: "evt-1",
    pModel: 0.58,
    components: { pinnacle_novig_home: 0.58 },
    book: { ts: 1, bids: [], asks: [{ priceCents: 55, size: 100 }], seq: 1 },
    decision: { action: "trade", side: "yes", contracts: 5, reason: "edge" },
    rawEdgeCents: 3,
    feePerContractCents: 2,
    vwapFillCents: 55,
    filledContracts: 5,
    midAtFillCents: 54,
    toxicity: {
      dueTs: Date.now() - 1000,
      markedTs: null,
      midCents: null,
      movedAgainst: null,
    },
    outcome: null,
    ...partial,
  };
}

describe("shadow maintenance", () => {
  test("recomputeHashChain restores valid chain after edit", () => {
    const raw = tradeLine();
    const chained = recomputeHashChain([raw]);
    expect(verifyHashChain(chained)).toBe(true);
  });

  test("markDueToxicity applies mid when due", () => {
    const { lines, marked } = markDueToxicity([tradeLine()], { KXTEST: 48 });
    expect(marked).toBe(1);
    expect(lines[0]!.toxicity.markedTs).not.toBeNull();
    expect(lines[0]!.toxicity.movedAgainst).toBe(true);
  });

  test("applyOutcomes sets outcome by eventId", () => {
    const { lines, updated } = applyOutcomes([tradeLine()], { "evt-1": 1 });
    expect(updated).toBe(1);
    expect(lines[0]!.outcome).toBe(1);
  });

  test("runToxicityMark rewrites program log", async () => {
    const alphaRoot = joinPath(import.meta.dir, ".tmp-maint-prog");
    const dir = joinPath(alphaRoot, "maint-test");
    await Bun.$`rm -rf ${alphaRoot}`.quiet();
    await Bun.$`mkdir -p ${dir}`.quiet();
    const logPath = joinPath(dir, "shadow-log.jsonl");
    await Bun.write(
      joinPath(dir, "program.json"),
      JSON.stringify({
        name: "maint-test",
        dimension: "sports-nba",
        status: "shadow",
        baseline: "pinnacle-novig",
        created: "2026-07-22",
        shadowLog: "shadow-log.jsonl",
        hypothesisFile: "hypothesis.md",
        gates: {
          shadowMinSignals: 100,
          shadowMinWeeks: 3,
          pilotMaxContracts: 5,
          killBrierDriftPct: 15,
          graduationMinRealizedEdgeCentsPerFill: 2,
          graduationMinFills: 30,
        },
      }),
    );
    const line = recomputeHashChain([tradeLine({ program: "maint-test" })])[0]!;
    await Bun.write(logPath, JSON.stringify(line) + "\n");

    const result = await runToxicityMark("maint-test", { KXTEST: 50 }, { alphaRoot });
    expect(result.marked).toBe(1);
    expect(result.chainValid).toBe(true);

    await Bun.$`rm -rf ${alphaRoot}`.quiet();
  });
});