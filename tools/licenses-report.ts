#!/usr/bin/env bun
/**
 * `bun run licenses:report` — render the license-compliance report
 * artifact (§103): a static markdown document for legal/release sign-off,
 * written to research/outputs/licenses-report.md (gitignored; regenerate
 * + attach at release time).
 *
 * Runs the gate offline (--json + --sbom for the drift section), computes
 * a config fingerprint (sha256 of both policy files) for auditability,
 * and renders via the pure lib. The report is ALWAYS written — a FAILING
 * gate produces a report with the violations listed and exits 1 (the FAIL
 * state IS the sign-off artifact).
 *
 * Args after the script name are forwarded to the gate (e.g. --config,
 * --overlay, --sbom <path> for fixture runs).
 */
import { join } from "node:path";
import { renderLicensesReport } from "../src/lib/licenses-report.ts";

const ROOT = join(import.meta.dir, "..");
const REPORT_PATH = join(ROOT, "research", "outputs", "licenses-report.md");
const DEFAULT_SBOM = ".data/licenses-sbom.json";

function sha256hex(text: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(text);
  return h.digest("hex").slice(0, 16);
}

async function configSha(): Promise<string> {
  const parts: string[] = [];
  for (const rel of ["config/licenses-allowlist.json", "config/audit-overrides.json"]) {
    try {
      parts.push(await Bun.file(join(ROOT, rel)).text());
    } catch {
      /* missing policy file — fingerprint what exists */
    }
  }
  return sha256hex(parts.join("\n"));
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const hasSbom = args.includes("--sbom");
  const spawnArgs = ["bun", "run", "licenses:gate", "--json", ...(hasSbom ? [] : ["--sbom", DEFAULT_SBOM]), ...args];
  const proc = Bun.spawnSync(spawnArgs, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout?.toString() ?? "";
  const stderr = proc.stderr?.toString() ?? "";
  let doc: ReturnType<typeof JSON.parse>;
  try {
    doc = JSON.parse(stdout);
  } catch {
    console.error("licenses:report — gate output was not JSON (gate failed hard)");
    console.error(stderr.slice(-400));
    process.exit(1);
  }
  const report = renderLicensesReport({ ...doc, configSha: await configSha() });
  await Bun.write(REPORT_PATH, report);
  console.log("licenses:report — wrote " + REPORT_PATH + " (gate " + (doc.ok ? "PASS" : "FAIL") + ")");
  return doc.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
