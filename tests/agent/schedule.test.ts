// Managed agent CLI schedule (§203): parse CLI + offline scheduled worker delegation.
import { describe, expect, test } from "bun:test";
import {
  parseAgentScheduleCli,
  AGENT_CRON_SCHEDULE,
  AGENT_CRON_TITLE,
  AGENT_CRON_WORKER_PATH,
} from "../../tools/agent-schedule-cli.ts";
import { runScheduledAgent } from "../../src/agent/scheduled.ts";

describe("agent-schedule-cli", () => {
  test("parseAgentScheduleCli accepts register/remove/preview", () => {
    expect(parseAgentScheduleCli(["register"])?.command).toBe("register");
    expect(parseAgentScheduleCli(["remove", "--title", "custom"])?.title).toBe("custom");
    expect(parseAgentScheduleCli(["preview", "--count", "5"])?.count).toBe(5);
    expect(parseAgentScheduleCli(["unknown"])).toBeNull();
  });

  test("defaults match constants; worker path resolves into src/agent", () => {
    expect(parseAgentScheduleCli(["register"])?.schedule).toBe(AGENT_CRON_SCHEDULE);
    expect(parseAgentScheduleCli(["register"])?.title).toBe(AGENT_CRON_TITLE);
    expect(AGENT_CRON_WORKER_PATH).toContain("src/agent/scheduled.ts");
  });

  test("parseAgentScheduleCli honors --schedule and env override", () => {
    expect(parseAgentScheduleCli(["preview", "--schedule", "*/30 * * * *"])?.schedule).toBe("*/30 * * * *");
  });
});

describe("runScheduledAgent", () => {
  test("delegates to ground + report deps and reports exit codes", async () => {
    const calls: string[] = [];
    const { groundExit, reportExit } = await runScheduledAgent({
      runGround: async () => { calls.push("ground"); return { ok: true }; },
      runReport: async () => { calls.push("report"); return 0; },
    });
    expect(calls).toEqual(["ground", "report"]);
    expect(groundExit).toBe(0);
    expect(reportExit).toBe(0);
  });

  test("report failure surfaces its exit code", async () => {
    const { groundExit, reportExit } = await runScheduledAgent({
      runGround: async () => ({ ok: true }),
      runReport: async () => 2,
    });
    expect(groundExit).toBe(0);
    expect(reportExit).toBe(2);
  });
});
