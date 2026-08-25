// licenses:gate contract test (§92) — the gate must pass on the current
// prod dependency set, and the vendored Unknown-license package must be
// explicitly allowed (never auto-allowed).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function runGate(): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(["bun", "run", "licenses:gate"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: proc.exitCode, stdout: (proc.stdout?.toString() ?? "") };
}

describe("licenses:gate (§92)", () => {
  test("exits 0 on the current prod dependency set", () => {
    const { exitCode, stdout } = runGate();
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/0 violations/);
  });

  test("vendored Unknown-license package is explicitly allowed", () => {
    const { stdout } = runGate();
    expect(stdout).toContain("@factorywager/proton-pass");
    expect(stdout).toContain("allowed");
  });
});