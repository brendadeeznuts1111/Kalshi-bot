// routes:probe (§122) — the Bun.serve routes API probe must pass 11/11.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("routes:probe (§122)", () => {
  test("all 11 routes-surface checks verified", () => {
    const proc = Bun.spawnSync(["bun", "tools/routes-probe.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = (proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? "");
    expect(out).toContain("11/11 checks");
    expect(out).not.toContain("FAIL");
  });
});
