// serve-stream:probe (§112) — the Bun.serve streaming probe must pass 13/13
// (P1-P4 streaming surface + P5-P9 backpressure, bun-v1.4 blog "Backpressure").
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("serve-stream:probe (§112)", () => {
  test("all 13 streaming surface + backpressure checks verified", () => {
    // probe spawns a Bun.serve + slow-client reads (~7s) — outsize the 5s default
    const proc = Bun.spawnSync(["bun", "tools/serve-stream-probe.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20000,
    });
    const out = (proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? "");
    if (proc.exitCode !== 0) console.log("PROBE OUTPUT:\n" + out); // identify the flaked check
    expect(proc.exitCode).toBe(0);
    expect(out).toContain("13/13 checks");
    expect(out).toContain("P5 pull() pauses for a slow client");
    expect(out).toContain("P5b pulls do not grow while the client is stalled");
    expect(out).toContain("P5c pulls resume when the client reads again");
    expect(out).toContain("P7 CompressionStream pipeline source pull() pauses");
    expect(out).toContain("P8 fetch upload body pull() pauses for a slow server");
    expect(out).toContain("P9 Bun.spawn stdout pauses for a slow reader");
    expect(out).toContain("P9b Bun.spawn stdout delivers all bytes with a slow reader");
    expect(out).not.toContain("FAIL");
  }, { timeout: 20000 });
});
