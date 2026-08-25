// licenses-report (§103) — renderer unit + CLI e2e (pass + fail renders).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { renderLicensesReport } from "../../src/lib/licenses-report.ts";

const ROOT = join(import.meta.dir, "../..");
const REPORT_PATH = join(ROOT, "research", "outputs", "licenses-report.md");

function baseInput() {
  return {
    ok: true,
    generatedAt: "2026-08-25T00:00:00.000Z",
    bunVersion: "1.4.0",
    summary: { total: 6, allowed: 6, violations: 0, exemptions: 1 },
    packages: [
      { name: "zod", version: "4.4.3", reportedLicense: "MIT", normalizedLicense: "MIT", allowed: true, matchedBy: "allowlist", fingerprint: "432f26c29410" },
      { name: "@factorywager/proton-pass", version: "vendor/proton-pass", reportedLicense: "Unknown", normalizedLicense: "Unknown", allowed: true, matchedBy: "exemption", fingerprint: "6a048843f8d4", reason: "vendored", expires: "2026-12-01", expiresInDays: 98 },
    ],
    violations: [] as { name: string; version: string; license: string; reason?: string }[],
    advisories: [] as { name: string; version: string; severity: string; note: string }[],
    expiringSoon: [] as { name: string; version: string; expires: string; expiresInDays: number; reason: string }[],
    staleExemptions: [] as string[],
    diff: { added: [] as string[], removed: [] as string[], changed: [] as string[] },
    configSha: "abc123",
  };
}

function runReport(args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(["bun", "run", "licenses:report", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: proc.exitCode, stdout: (proc.stdout?.toString() ?? "") };
}

describe("renderLicensesReport (§103)", () => {
  test("renders a passing report with table + exemption detail", () => {
    const md = renderLicensesReport(baseInput());
    expect(md).toContain("# License Compliance Report");
    expect(md).toContain("Gate status: **PASS**");
    expect(md).toContain("| zod | 4.4.3 | MIT | allowlist |");
    expect(md).toContain("exemption (expires 2026-12-01)");
    expect(md).toContain("expires 2026-12-01 (in 98 days)");
    expect(md).toContain("no dependency drift");
  });

  test("renders a FAILING report with violations and drift listed", () => {
    const input = baseInput();
    input.ok = false;
    input.summary.violations = 1;
    input.violations = [{ name: "drizzle-orm", version: "0.45.2", license: "Apache-2.0", reason: "no allowlist entry" }];
    input.diff = { added: ["new-pkg@1.0.0"], removed: ["old-pkg@2.0.0"], changed: [] };
    const md = renderLicensesReport(input);
    expect(md).toContain("Gate status: **FAIL**");
    expect(md).toContain("FAIL drizzle-orm@0.45.2");
    expect(md).toContain("+ added new-pkg@1.0.0");
    expect(md).toContain("- removed old-pkg@2.0.0");
  });
});

describe("licenses:report CLI (§103)", () => {
  const STRICT = join(ROOT, ".data", "licenses-report-strict.json");
  const TEST_SBOM = ".data/licenses-sbom.test-report.json";

  test("failing gate still writes the report and exits 1", async () => {
    const strict = { policy: { allowedLicenses: ["MIT"], licenseAliases: {} }, exemptions: [] };
    await Bun.write(STRICT, JSON.stringify(strict, null, 2) + "\n");
    try {
      const { exitCode, stdout } = runReport(["--config", STRICT, "--sbom", TEST_SBOM]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("gate FAIL");
      const md = await Bun.file(REPORT_PATH).text();
      expect(md).toContain("Gate status: **FAIL**");
      expect(md).toContain("FAIL drizzle-orm@0.45.2");
    } finally {
      await Bun.file(STRICT).delete();
      await Bun.file(join(ROOT, TEST_SBOM)).delete();
    }
  });

  test("passing gate writes a PASS report and exits 0", async () => {
    const { exitCode, stdout } = runReport([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("gate PASS");
    const md = await Bun.file(REPORT_PATH).text();
    expect(md).toContain("Gate status: **PASS**");
    expect(md).toContain("| zod | 4.4.3 |");
  });
});
