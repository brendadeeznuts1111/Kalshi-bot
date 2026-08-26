// bash-mode tier gate tests (docs/CODE_MODE.md) - plan = read-only, code = full.
import { describe, expect, test } from "bun:test";
import { classifyBashTier, runBashInMode } from "../../src/lib/bash-mode.ts";

describe("classifyBashTier", () => {
  test("read-only verbs classify as read-only", () => {
    expect(classifyBashTier("rg TODO src")).toBe("read-only");
    expect(classifyBashTier("cat package.json")).toBe("read-only");
    expect(classifyBashTier("git status")).toBe("read-only");
    expect(classifyBashTier("bun x tsc --noEmit")).toBe("read-only");
    expect(classifyBashTier("bun test tests/lib")).toBe("read-only");
  });

  test("mutating commands classify as full", () => {
    expect(classifyBashTier("bun install")).toBe("full");
    expect(classifyBashTier("rm -rf x")).toBe("full");
    expect(classifyBashTier("bun run build")).toBe("full");
    expect(classifyBashTier("rg a src && bun install")).toBe("full");
  });

  test("compound read-only chains stay read-only", () => {
    expect(classifyBashTier("rg a src && rg b src")).toBe("read-only");
  });
});

describe("runBashInMode", () => {
  test("plan mode blocks full-tier commands with an explicit result", async () => {
    const r = await runBashInMode("bun install", "plan");
    expect(r.blocked).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("[plan mode] blocked");
  });

  test("plan mode allows read-only commands", async () => {
    const r = await runBashInMode("echo plan-ok", "plan");
    expect(r.blocked).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe("plan-ok");
  });

  test("code mode executes full-tier commands", async () => {
    const r = await runBashInMode("echo code-ok", "code");
    expect(r.blocked).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe("code-ok");
  });
});