// Agent CLI code-mode gate: --mode plan blocks mutating agent bash (docs/CODE_MODE.md, §191).
import { describe, expect, test } from "bun:test";
import { runAgentTennis } from "../../src/agent/cli.ts";

describe("agent code-mode gate", () => {
  test("plan mode blocks the canary smoke (returns 1, no run)", async () => {
    const code = await runAgentTennis(true, { canary: true, mode: "plan" });
    expect(code).toBe(1);
  });

  test("code mode (default) is not blocked by the plan gate", async () => {
    const code = await runAgentTennis(true, { canary: false, mode: "code" });
    expect(code).not.toBe(1); // runs the cache-only path, not the canary
  });
});