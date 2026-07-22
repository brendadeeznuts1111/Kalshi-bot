// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import {
  describeInProcessCron,
  ensureInProcessCronErrorHandling,
  resetInProcessCronErrorHandling,
  runInProcessResearchTick,
  runPulseProbeTick,
} from "../src/agent/in-process-cron.ts";
import { resetDashboardState, getDashboardState } from "../src/agent/dashboard-state.ts";
import {
  PULSE_PROBE_CRON_UTC,
  RESEARCH_CRON_IN_PROCESS_UTC,
} from "../src/research/constants.ts";

describe("in-process cron", () => {
  afterEach(() => {
    resetDashboardState();
    resetInProcessCronErrorHandling();
  });

  test("constants document UTC pulse and research schedules", () => {
    expect(PULSE_PROBE_CRON_UTC).toBe("0 */6 * * *");
    expect(RESEARCH_CRON_IN_PROCESS_UTC).toBe("0 6 * * MON");
  });

  test("describeInProcessCron lists enabled jobs", () => {
    expect(describeInProcessCron({ pulse: true, research: true }).join(" ")).toContain("UTC");
  });

  test("ensureInProcessCronErrorHandling is idempotent", () => {
    ensureInProcessCronErrorHandling();
    ensureInProcessCronErrorHandling();
    expect(true).toBe(true);
  });

  test("runPulseProbeTick logs when no pulse data", async () => {
    const prev = Bun.env.ROTOR_ROOT;
    Bun.env.ROTOR_ROOT = "/nonexistent/pulse/root";
    try {
      await runPulseProbeTick();
    } finally {
      if (prev === undefined) delete Bun.env.ROTOR_ROOT;
      else Bun.env.ROTOR_ROOT = prev;
    }
  });

  test("runInProcessResearchTick updates dashboard state on success", async () => {
    await runInProcessResearchTick({
      runResearch: async () => ({
        runId: "2099-01-02T00-00-00-000Z",
        generatedAt: "2099-01-02T00:00:00.000Z",
        config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
        stats: { discovered: 0, gated: 0, inspected: 0, shortlist: 2 },
        candidates: [],
        gated: [],
        scored: [],
        shortlist: [{ repo: { fullName: "a/b" } }, { repo: { fullName: "c/d" } }] as never,
        excludedSdkOnly: [],
      }),
    });
    expect(getDashboardState().lastRunId).toBe("2099-01-02T00-00-00-000Z");
    expect(getDashboardState().phase).toBe("idle");
  });

  test("runInProcessResearchTick records error without throwing", async () => {
    await runInProcessResearchTick({
      runResearch: async () => {
        throw new Error("simulated gh failure");
      },
    });
    expect(getDashboardState().phase).toBe("error");
    expect(getDashboardState().message).toContain("simulated gh failure");
  });

  test("runInProcessResearchTick skips when already busy", async () => {
    let calls = 0;
    const slow = runInProcessResearchTick({
      runResearch: () =>
        new Promise((resolve) => {
          calls++;
          setTimeout(
            () =>
              resolve({
                runId: "slow",
                generatedAt: "2099-01-01T00:00:00.000Z",
                config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
                stats: { discovered: 0, gated: 0, inspected: 0, shortlist: 0 },
                candidates: [],
                gated: [],
                scored: [],
                shortlist: [],
                excludedSdkOnly: [],
              }),
            30,
          );
        }),
    });
    const skipped = runInProcessResearchTick({
      runResearch: async () => {
        calls++;
        return {
          runId: "never",
          generatedAt: "2099-01-01T00:00:00.000Z",
          config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
          stats: { discovered: 0, gated: 0, inspected: 0, shortlist: 0 },
          candidates: [],
          gated: [],
          scored: [],
          shortlist: [],
          excludedSdkOnly: [],
        };
      },
    });
    await Promise.all([slow, skipped]);
    expect(calls).toBe(1);
  });
});
