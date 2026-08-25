// ws:probe (§114) — the Bun.serve WebSocket surface probe must pass 7/7.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("ws:probe (§114)", () => {
  test("all 8 websocket surface checks verified", () => {
    const proc = Bun.spawnSync(["bun", "tools/ws-probe.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = (proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? "");
    expect(out).toContain("8/8 checks");
    expect(out).not.toContain("FAIL");
  });
});
