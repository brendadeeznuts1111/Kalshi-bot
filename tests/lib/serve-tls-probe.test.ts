// serve-tls:probe (§123) — TLS serve + the http2/http3 reality must pass 5/5.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("serve-tls:probe (§123)", () => {
  test("all 5 TLS/serve-option checks verified", () => {
    const proc = Bun.spawnSync(["bun", "tools/serve-tls-probe.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const out = (proc.stdout?.toString() ?? "") + (proc.stderr?.toString() ?? "");
    expect(out).toContain("5/5 checks");
    expect(out).not.toContain("FAIL");
  });
});
