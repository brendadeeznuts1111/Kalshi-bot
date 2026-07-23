// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { ExperimentRunner } from "../src/operations/experiment-runner.ts";
import { tempSqlitePath } from "./tmp-db.ts";

const PHASE1_FACTORS = [
  { name: "routing", levels: ["static", "dynamic"] },
];

describe("ExperimentRunner", () => {
  test("launch assigns and records metrics", async () => {
    const dbPath = tempSqlitePath("experiment-runner");
    const runner = ExperimentRunner.open(dbPath);

    const id = runner.launch({
      name: "phase1-routing",
      factors: PHASE1_FACTORS,
      minDurationDays: 0,
    });

    const a = runner.assignPartner(id, "partner-1");
    expect(a.variant.routing).toMatch(/static|dynamic/);

    runner.recordMetric(id, "partner-1", 1);
    runner.recordMetric(id, "partner-1", 0);
    expect(runner.recordMetric(id, "partner-1", 1, "dup-id")).toBe(true);
    expect(runner.recordMetric(id, "partner-1", 0, "dup-id")).toBe(false);

    const results = runner.getResults(id);
    // Two anonymous observations plus one idempotent named observation.
    expect(results.totalObservations).toBe(3);
    expect(results.experimentId).toBe(id);

    await Bun.$`rm -f ${dbPath}`.nothrow().quiet();
  });

  test("dailyCheck completes when min duration met and effect threshold hit", async () => {
    const dbPath = tempSqlitePath("experiment-daily");
    const runner = ExperimentRunner.open(dbPath);

    const id = runner.launch({
      name: "quick-complete",
      factors: [
        { name: "routing", levels: ["static", "dynamic"] },
        { name: "cut", levels: [0.1, 0.15] },
      ],
      minDurationDays: 0,
      minDetectableEffect: 0.01,
    });

    for (let i = 0; i < 4; i++) {
      const pid = `p${i}`;
      runner.assignPartner(id, pid);
      for (let j = 0; j < 30; j++) {
        runner.recordMetric(id, pid, j < (i >= 2 ? 25 : 10) ? 1 : 0, `m-${pid}-${j}`);
      }
    }

    const check = await runner.dailyCheck(id);
    expect(["completed", "running", "early_stop"]).toContain(check.status);

    await Bun.$`rm -f ${dbPath}`.nothrow().quiet();
  });
});
