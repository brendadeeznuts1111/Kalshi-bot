// spawn:probe (§113) — the Bun.spawn behaviors probe must pass 6/6.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("spawn:probe (§113)", () => {
  test("all 6 spawn behavior checks verified", () => {
    const proc = Bun.spawnSync(["bun", "tools/spawn-probe.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = (proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? "");
    expect(out).toContain("6/6 checks");
    expect(out).not.toContain("FAIL");
  });
});
