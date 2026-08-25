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
    expect(Array.isArray(doc.advisories)).toBe(true);
    expect(doc.advisories.length).toBe(0); // clean tree — overlay warn-only
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
describe("licenses:gate --config (§96)", () => {
  const STRICT_PATH = join(ROOT, ".data", "licenses-config-strict.json");
  const WARN_PATH = join(ROOT, ".data", "licenses-config-warn.json");

  test("strict policy fails the gate with a named violation", async () => {
    const strict = { policy: { allowedLicenses: ["MIT"], licenseAliases: {} }, exemptions: [] };
    await Bun.write(STRICT_PATH, JSON.stringify(strict, null, 2) + "\n");
    try {
      const { exitCode, stdout } = runGateArgs(["--config", STRICT_PATH]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("FAIL drizzle-orm@0.45.2");
      expect(stdout).toContain("licenses:gate — FAIL");
    } finally {
      await Bun.file(STRICT_PATH).delete();
    }
  });

  test("wide warning window surfaces expiring exemptions in --json", async () => {
    const warn = { policy: { allowedLicenses: ["MIT", "Apache-2.0"], licenseAliases: {}, expiryWarningDays: 365 }, exemptions: [{ name: "@factorywager/proton-pass", license: "Unknown", expires: "2026-12-01" }] };
    await Bun.write(WARN_PATH, JSON.stringify(warn, null, 2) + "\n");
    try {
      const { exitCode, stdout } = runGateArgs(["--config", WARN_PATH, "--json"]);
      expect(exitCode).toBe(0);
      const doc = JSON.parse(stdout);
      expect(doc.expiringSoon.length).toBe(1);
      expect(doc.expiringSoon[0].name).toBe("@factorywager/proton-pass");
      expect(doc.expiringSoon[0].expiresInDays).toBeGreaterThan(0);
    } finally {
      await Bun.file(WARN_PATH).delete();
    }
  });
});

