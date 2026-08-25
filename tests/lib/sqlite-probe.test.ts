// sqlite:probe (§111) — the bun:sqlite feature-surface probe must pass 9/9.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("sqlite:probe (§111)", () => {
  test("all 9 bun:sqlite surface checks verified against the runtime", () => {
    const proc = Bun.spawnSync(["bun", "tools/sqlite-probe.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = (proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? "");
    expect(out).toContain("9/9 checks");
    expect(out).not.toContain("FAIL");
  });
});
