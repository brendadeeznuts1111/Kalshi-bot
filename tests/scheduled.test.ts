// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { runScheduledResearch } from "../src/research/scheduled.ts";
import type { ResearchRun } from "../src/research/types.ts";

describe("runScheduledResearch", () => {
  test("delegates to injected runResearch", async () => {
    let called = false;
    const fakeRun: ResearchRun = {
      runId: "scheduled-test",
      generatedAt: "2026-07-22T00:00:00.000Z",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    };

    const run = await runScheduledResearch({
      runResearch: async (opts) => {
        called = true;
        expect(opts.json).toBe(false);
        return fakeRun;
      },
    });

    expect(called).toBe(true);
    expect(run.runId).toBe("scheduled-test");
  });
});
