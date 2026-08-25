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
function runGateArgs(args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(["bun", "run", "licenses:gate", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: proc.exitCode, stdout: (proc.stdout?.toString() ?? "") };
}

describe("licenses:gate --json (§93)", () => {
  test("emits parseable JSON with 0 violations", () => {
    const { exitCode, stdout } = runGateArgs(["--json"]);
    expect(exitCode).toBe(0);
    const doc = JSON.parse(stdout);
    expect(doc.ok).toBe(true);
    expect(doc.summary.total).toBe(6);
    expect(doc.summary.violations).toBe(0);
    expect(doc.packages.length).toBe(6);
  });

  test("JSON carries the vendor exemption", () => {
    const { stdout } = runGateArgs(["--json"]);
    const doc = JSON.parse(stdout);
    const pp = doc.packages.find((p: any) => p.name === "@factorywager/proton-pass");
    expect(pp).toBeTruthy();
    expect(pp.matchedBy).toBe("exemption");
  });
});

describe("licenses:gate --sbom (§93)", () => {
  const SBOM_TEST_PATH = join(ROOT, ".data", "licenses-sbom.test.json");

  test("writes a snapshot with per-package fingerprints", async () => {
    try { await Bun.file(SBOM_TEST_PATH).delete(); } catch { /* fresh start */ }
    const { exitCode, stdout } = runGateArgs(["--sbom", SBOM_TEST_PATH]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("+ added");
    const raw = await Bun.file(SBOM_TEST_PATH).json();
    expect(raw.format).toBe("licenses-sbom");
    expect(raw.packages.length).toBe(6);
    for (const p of raw.packages) expect(p.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    await Bun.file(SBOM_TEST_PATH).delete();
  });
});
