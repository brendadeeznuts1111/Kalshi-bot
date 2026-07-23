// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExperimentRunner } from "../src/operations/experiment-runner.ts";
import { ingestShadowMetrics } from "../src/operations/experiment-shadow-bridge.ts";

const PHASE1 = [{ name: "routing", levels: ["static", "dynamic"] }];

function shadowPrediction(eventId: string, outcome: 0 | 1, lineHash: string) {
  return JSON.stringify({
    kind: "prediction",
    prevHash: "0",
    ts: Date.now(),
    program: "tennis-game-model",
    ticker: "T1",
    eventId,
    pModel: 0.5,
    components: {},
    book: { ts: Date.now(), bids: [], asks: [], seq: 0 },
    decision: { action: "trade", contracts: 1, reason: "fixture" },
    rawEdgeCents: 1,
    feePerContractCents: 0,
    vwapFillCents: 50,
    filledContracts: 1,
    midAtFillCents: 50,
    toxicity: { dueTs: 0, markedTs: null, midCents: null, movedAgainst: null },
    outcome,
    lineHash,
  });
}

describe("experiment-shadow-bridge integration", () => {
  test("ingestShadowMetrics writes assigned partner outcomes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shadow-bridge-"));
    const dbPath = join(dir, "ops.db");
    const logPath = join(dir, "shadow.jsonl");
    try {
      const runner = ExperimentRunner.open(dbPath);
      const expId = runner.launch({ name: "ingest-test", factors: PHASE1, minDurationDays: 0 });
      runner.assignPartner(expId, "evt-win");
      runner.assignPartner(expId, "evt-skip");

      await Bun.write(
        logPath,
        [
          shadowPrediction("evt-win", 1, "hash-win"),
          shadowPrediction("evt-skip", 0, "hash-skip"),
          shadowPrediction("evt-unassigned", 1, "hash-no-assign"),
        ].join("\n") + "\n",
      );

      const summary = await ingestShadowMetrics({
        experimentId: expId,
        programName: "tennis-game-model",
        logPath,
        dbPath,
      });

      expect(summary.inserted).toBe(2);
      expect(summary.skipped).toBe(0);
      expect(summary.errors).toBe(1);

      const results = runner.getResults(expId);
      expect(results.totalObservations).toBe(2);
      expect(results.grandMean).toBe(0.5);

      const dup = await ingestShadowMetrics({
        experimentId: expId,
        programName: "tennis-game-model",
        logPath,
        dbPath,
      });
      expect(dup.inserted).toBe(0);
      expect(dup.skipped).toBe(2);
      expect(dup.errors).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
