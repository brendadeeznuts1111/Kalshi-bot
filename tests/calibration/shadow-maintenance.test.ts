// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../../src/research/paths.ts";
import {
  appendOutcomeResolutions,
  appendToxicityMarks,
  materializeShadowLines,
  readShadowLogEntries,
  sealPredictionLine,
  selectDueToxicityMarks,
  TOXICITY_DUE_OFFSET_MS,
  TOXICITY_MARK_WINDOW_MS,
  verifyHashChainEntries,
  isPredictionEntry,
  type ShadowPredictionLine,
} from "../../src/institutions/shadow-line.ts";
import { runToxicityMark, runOutcomeResolution } from "../../src/calibration/shadow-maintenance.ts";

function tradeLine(partial: Partial<ShadowPredictionLine> = {}): ShadowPredictionLine {
  const ts = partial.ts ?? Date.now() - 120_000;
  return sealPredictionLine({
    kind: "prediction",
    prevHash: "0",
    lineHash: "x",
    ts,
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
      dueTs: ts + TOXICITY_DUE_OFFSET_MS,
      markedTs: null,
      midCents: null,
      movedAgainst: null,
    },
    outcome: null,
    ...partial,
  });
}

describe("shadow maintenance (append-only)", () => {
  test("selectDueToxicityMarks only marks inside T+60s window", () => {
    const ts = Date.now() - TOXICITY_DUE_OFFSET_MS - 5_000;
    const line = tradeLine({ ts, toxicity: { dueTs: ts + TOXICITY_DUE_OFFSET_MS, markedTs: null, midCents: null, movedAgainst: null } });
    const inWindow = selectDueToxicityMarks([line], ts + TOXICITY_DUE_OFFSET_MS + 5_000);
    expect(inWindow.toMark.length).toBe(1);

    const missed = selectDueToxicityMarks([line], ts + TOXICITY_DUE_OFFSET_MS + TOXICITY_MARK_WINDOW_MS + 1);
    expect(missed.toMark.length).toBe(0);
    expect(missed.missed).toBe(1);
  });

  test("appendToxicityMarks leaves prediction line immutable", async () => {
    const alphaRoot = joinPath(import.meta.dir, ".tmp-maint-prog");
    const dir = joinPath(alphaRoot, "maint-test");
    await Bun.$`rm -rf ${alphaRoot}`.quiet();
    await Bun.$`mkdir -p ${dir}`.quiet();
    const logPath = joinPath(dir, "shadow-log.jsonl");
    const prediction = tradeLine({ program: "maint-test", ts: Date.now() - 120_000 });
    await Bun.write(logPath, JSON.stringify(prediction) + "\n");
    const predictionJson = JSON.stringify(prediction);

    await appendToxicityMarks(logPath, "maint-test", [{ line: prediction, midCents: 50 }]);
    const entries = await readShadowLogEntries(logPath);
    expect(entries.length).toBe(2);
    expect(JSON.stringify(entries[0])).toBe(predictionJson);
    expect(entries[1]?.kind).toBe("toxicity-mark");
    expect(verifyHashChainEntries(entries)).toBe(true);

    const materialized = materializeShadowLines(entries);
    expect(materialized[0]!.toxicity.midCents).toBe(50);
    expect(materialized[0]!.toxicity.movedAgainst).toBe(true);

    await Bun.$`rm -rf ${alphaRoot}`.quiet();
  });

  test("appendOutcomeResolutions joins at read time", async () => {
    const alphaRoot = joinPath(import.meta.dir, ".tmp-outcome-prog");
    const dir = joinPath(alphaRoot, "outcome-test");
    await Bun.$`rm -rf ${alphaRoot}`.quiet();
    await Bun.$`mkdir -p ${dir}`.quiet();
    const logPath = joinPath(dir, "shadow-log.jsonl");
    const prediction = tradeLine({ program: "outcome-test", eventId: "evt-1" });
    await Bun.write(logPath, JSON.stringify(prediction) + "\n");

    const updated = await appendOutcomeResolutions(logPath, "outcome-test", { "evt-1": 1 });
    expect(updated).toBe(1);
    const materialized = materializeShadowLines(await readShadowLogEntries(logPath));
    expect(materialized[0]!.outcome).toBe(1);
    expect(JSON.parse(JSON.stringify(prediction)).outcome).toBeNull();

    await Bun.$`rm -rf ${alphaRoot}`.quiet();
  });

  test("runToxicityMark appends mark entries without rewriting predictions", async () => {
    const alphaRoot = joinPath(import.meta.dir, ".tmp-maint-prog2");
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
          graduationMinDistinctEvents: 40,
        },
      }),
    );
    const prediction = tradeLine({
      program: "maint-test",
      ts: Date.now() - TOXICITY_DUE_OFFSET_MS - 5_000,
    });
    await Bun.write(logPath, JSON.stringify(prediction) + "\n");

    const prevEnv = Bun.env.NODE_ENV;
    Bun.env.NODE_ENV = "test";
    const result = await runToxicityMark("maint-test", { KXTEST: 50 }, { alphaRoot, forceDue: true });
    Bun.env.NODE_ENV = prevEnv;

    expect(result.marked).toBe(1);
    expect(result.chainValid).toBe(true);
    const entries = await readShadowLogEntries(logPath);
    expect(entries.length).toBe(2);
    expect(isPredictionEntry(entries[0]!)).toBe(true);
    expect(entries[1]?.kind).toBe("toxicity-mark");

    await Bun.$`rm -rf ${alphaRoot}`.quiet();
  });

  test("runOutcomeResolution appends resolution lines", async () => {
    const alphaRoot = joinPath(import.meta.dir, ".tmp-maint-prog3");
    const dir = joinPath(alphaRoot, "maint-test");
    await Bun.$`rm -rf ${alphaRoot}`.quiet();
    await Bun.$`mkdir -p ${dir}`.quiet();
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
          graduationMinDistinctEvents: 40,
        },
      }),
    );
    await Bun.write(joinPath(dir, "shadow-log.jsonl"), JSON.stringify(tradeLine({ program: "maint-test" })) + "\n");

    const result = await runOutcomeResolution("maint-test", { "evt-1": 0 }, { alphaRoot });
    expect(result.updated).toBe(1);
    expect(result.chainValid).toBe(true);
    await Bun.$`rm -rf ${alphaRoot}`.quiet();
  });
});
