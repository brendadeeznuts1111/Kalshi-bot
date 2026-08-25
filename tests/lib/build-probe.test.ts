// bun:build-probe (§109) — the build-system claims probe must pass 9/9.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("bun:build-probe (§109)", () => {
  test("all 9 build-system claims verified against the runtime", () => {
    const proc = Bun.spawnSync(["bun", "tools/build-probe.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = (proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? "");
    expect(out).toContain("9/9 claims verified");
    expect(out).not.toContain("FAIL");
  });
});
