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
function runGateArgs(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["bun", "run", "licenses:gate", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: proc.exitCode, stdout: (proc.stdout?.toString() ?? ""), stderr: (proc.stderr?.toString() ?? "") };
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
import { resolveLicensesData } from "../../tools/licenses-gate.ts";

describe("resolveLicensesData (§100)", () => {
  test("non-zero exit fails CLOSED with a toolchain hint", () => {
    expect(() => resolveLicensesData("", "", 1)).toThrow(/exited 1/);
  });

  test("exit 0 with non-JSON output fails with a parse hint", () => {
    expect(() => resolveLicensesData("bun pm: error output", "", 0)).toThrow(/non-JSON/);
  });

  test("valid JSON resolves and parses", () => {
    const data = resolveLicensesData('{ "MIT": [{ "name": "zod", "versions": ["4.4.3"] }] }', "", 0);
    expect(data.MIT?.[0]!.name).toBe("zod");
  });
});

describe("licenses:gate --overlay (§100)", () => {
  const FIXTURE = join(ROOT, ".data", "licenses-overlay-fixture.json");

  test("surfaces advisories from an alternate overlay without changing exit code", async () => {
    const fixture = { format: "audit-overrides", version: 1, advisories: { "zod@4.4.3": { severity: "high", note: "fixture" } } };
    await Bun.write(FIXTURE, JSON.stringify(fixture, null, 2) + "\n");
    try {
      const { exitCode, stdout } = runGateArgs(["--overlay", FIXTURE, "--json"]);
      expect(exitCode).toBe(0);
      const doc = JSON.parse(stdout);
      expect(doc.advisories.length).toBe(1);
      expect(doc.advisories[0].name).toBe("zod");
      expect(doc.advisories[0].severity).toBe("high");
    } finally {
      await Bun.file(FIXTURE).delete();
    }
  });

  test("--overlay runs do not pollute the live licenses-state.json", async () => {
    const fixture = { format: "audit-overrides", version: 1, advisories: {} };
    await Bun.write(FIXTURE, JSON.stringify(fixture, null, 2) + "\n");
    try {
      runGateArgs(["--overlay", FIXTURE, "--json"]);
      const state = await Bun.file(join(ROOT, ".data", "licenses-state.json")).json();
      expect(state.advisories).toBe(0);
    } finally {
      await Bun.file(FIXTURE).delete();
    }
  });
});
describe("licenses:gate operator-visible failure formats (§101 review)", () => {
  const EXPIRED_PATH = join(ROOT, ".data", "licenses-config-expired.json");

  test("expired exemption fails with expiry date + Action hint in HUMAN output", async () => {
    const expired = { policy: { allowedLicenses: ["MIT", "Apache-2.0"], licenseAliases: {} }, exemptions: [{ name: "@factorywager/proton-pass", license: "Unknown", expires: "2026-01-01", remediation: "upgrade to v2" }] };
    await Bun.write(EXPIRED_PATH, JSON.stringify(expired, null, 2) + "\n");
    try {
      const { exitCode, stdout } = runGateArgs(["--config", EXPIRED_PATH]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("exemption expired on 2026-01-01");
      expect(stdout).toContain("Action: upgrade to v2");
    } finally {
      await Bun.file(EXPIRED_PATH).delete();
    }
  });

  test("advisory matches print the warn line in HUMAN output (exit code unchanged)", async () => {
    const FIX = join(ROOT, ".data", "licenses-overlay-warn.json");
    const fixture = { format: "audit-overrides", version: 1, advisories: { "zod@4.4.3": { severity: "high", note: "fixture note" } } };
    await Bun.write(FIX, JSON.stringify(fixture, null, 2) + "\n");
    try {
      const { exitCode, stdout } = runGateArgs(["--overlay", FIX]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("warn advisory zod@4.4.3 (high)");
      expect(stdout).toContain("fixture note");
    } finally {
      await Bun.file(FIX).delete();
    }
  });

  test("--sbom with a fixture config demands an explicit snapshot path (no committed-snapshot pollution)", async () => {
    const FIX = join(ROOT, ".data", "licenses-config-guard.json");
    const strict = { policy: { allowedLicenses: ["MIT"], licenseAliases: {} }, exemptions: [] };
    await Bun.write(FIX, JSON.stringify(strict, null, 2) + "\n");
    try {
      const { exitCode, stdout, stderr } = runGateArgs(["--config", FIX, "--sbom"]);
      expect(exitCode).toBe(1);
      expect((stdout + stderr)).toContain("explicit --sbom path");
    } finally {
      await Bun.file(FIX).delete();
    }
  });
});



