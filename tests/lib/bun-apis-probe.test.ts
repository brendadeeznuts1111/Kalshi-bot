// bun:apis-probe (§115) — the v1.4 API-table claims probe must pass 4/4.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("bun:apis-probe (§115)", () => {
  test("all 4 API-surface checks verified", () => {
    const proc = Bun.spawnSync(["bun", "tools/bun-apis-probe.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = (proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? "");
    expect(out).toContain("4/4 checks");
    expect(out).not.toContain("FAIL");
  });
});
