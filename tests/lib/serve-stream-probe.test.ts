// serve-stream:probe (§112) — the Bun.serve streaming probe must pass 4/4.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("serve-stream:probe (§112)", () => {
  test("all 4 streaming surface checks verified", () => {
    const proc = Bun.spawnSync(["bun", "tools/serve-stream-probe.ts"], {
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
