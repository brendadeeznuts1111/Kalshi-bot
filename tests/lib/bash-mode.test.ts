// bash-mode tier gate tests (docs/CODE_MODE.md) - plan = read-only, code = full.
// v2: strict verb set, redirects, pipelines, && chains, env prefixes, wrappers.
import { describe, expect, test } from "bun:test";
import { classifyBashTier, runBashInMode } from "../../src/lib/bash-mode.ts";

describe("classifyBashTier - read-only", () => {
  test("read verbs classify read-only", () => {
    expect(classifyBashTier("rg TODO src")).toBe("read-only");
    expect(classifyBashTier("cat package.json")).toBe("read-only");
    expect(classifyBashTier("git status")).toBe("read-only");
    expect(classifyBashTier("git diff")).toBe("read-only");
    expect(classifyBashTier("bun x tsc --noEmit")).toBe("read-only");
  });

  test("env prefixes and wrappers are stripped before classifying", () => {
    expect(classifyBashTier("NODE_ENV=test bun x tsc")).toBe("read-only");
    expect(classifyBashTier("time rg a src")).toBe("read-only");
  });

  test("read-only pipelines and && chains stay read-only", () => {
    expect(classifyBashTier("rg a src | head")).toBe("read-only");
    expect(classifyBashTier("rg a src && rg b src")).toBe("read-only");
    expect(classifyBashTier("cat pkg.json && echo hi")).toBe("read-only");
  });
});

describe("classifyBashTier - full (mutating/executing)", () => {
  test("bun test is FULL: tests execute arbitrary code", () => {
    expect(classifyBashTier("bun test")).toBe("full");
  });

  test("install/build/run/push are full", () => {
    expect(classifyBashTier("bun install")).toBe("full");
    expect(classifyBashTier("bun run build")).toBe("full");
    expect(classifyBashTier("git push")).toBe("full");
    expect(classifyBashTier("sudo bun install")).toBe("full");
  });

  test("code-executing interpreters are full (absent from the strict set)", () => {
    expect(classifyBashTier("node -e x")).toBe("full");
    expect(classifyBashTier("python3 x.py")).toBe("full");
    expect(classifyBashTier("curl -o out file")).toBe("full");
    expect(classifyBashTier("tar xf a.tar")).toBe("full");
  });

  test("output redirects are full; mixed pipelines/chains are full", () => {
    expect(classifyBashTier("echo hi > out.txt")).toBe("full");
    expect(classifyBashTier("rg a src | bun install")).toBe("full");
    expect(classifyBashTier("rg a src && bun install")).toBe("full");
  });
});

describe("runBashInMode", () => {
  test("plan mode blocks full-tier commands with an explicit result", async () => {
    const r = await runBashInMode("bun test", "plan");
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
