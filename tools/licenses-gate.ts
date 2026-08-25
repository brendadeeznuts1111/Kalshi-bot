#!/usr/bin/env bun
/**
 * `bun run licenses:gate` — license-compliance gate for the production
 * dependency set (AGENT-PITFALLS §92/§93).
 *
 * Policy lives in config/licenses-allowlist.json (no recompilation to
 * change): allowedLicenses (canonical SPDX), licenseAliases (loose
 * spellings), exemptions (name + license/version scope + optional
 * expiry).
 *
 * Flags:
 *   --json       emit a machine-readable JSON document to stdout
 *   --sbom [p]   write an SBOM snapshot (default .data/licenses-sbom.json)
 *                and print a diff vs the previous snapshot (logbook mode)
 *
 * Robustness: stdout JSON is tried first; on parse failure stderr is
 * tried (bun may route the payload or the error there). Exit 1 on any
 * violation, including an EXPIRED exemption — the time-bomb forces
 * periodic review of vendor exceptions.
 */
import { join } from "node:path";
import { advisoryFor, evaluatePackage, findStaleExemptions, normalizeAuditOverlay, validateAuditOverrides, validatePolicyConfig } from "../src/lib/licenses-policy.ts";
import type { AuditOverlay, LicenseExemption, LicensePolicy } from "../src/lib/licenses-policy.ts";

const ROOT = join(import.meta.dir, "..");
const CONFIG_PATH = join(ROOT, "config", "licenses-allowlist.json");
const OVERLAY_PATH = join(ROOT, "config", "audit-overrides.json");
const DEFAULT_SBOM_PATH = join(ROOT, ".data", "licenses-sbom.json");

interface RawPackage {
  name: string;
  versions?: string[];
  license?: string;
  paths?: string[];
}

interface SbomEntry {
  name: string;
  version: string;
  reportedLicense: string;
  normalizedLicense: string;
  allowed: boolean;
  matchedBy: string | null;
  fingerprint: string;
  reason?: string;
  expires?: string;
  expiresInDays?: number;
}

function sha256(text: string): string {
  const h = new Bun.CryptoHasher("sha256");
  h.update(text);
  return h.digest("hex").slice(0, 12);
}

async function loadConfig(configPath: string): Promise<{ policy: LicensePolicy; exemptions: LicenseExemption[] }> {
  const file = Bun.file(configPath);
  const raw = await file.json(); // throws on malformed JSON — caller reports
  const err = validatePolicyConfig(raw);
  if (err) throw new Error("config/licenses-allowlist.json: " + err);
  const c = raw as { policy: LicensePolicy; exemptions?: LicenseExemption[] };
  return { policy: c.policy, exemptions: c.exemptions ?? [] };
}

function parseLicensesOutput(text: string): Record<string, RawPackage[]> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

async function fingerprintFor(p: RawPackage): Promise<string> {
  const dir = p.paths?.[0];
  let fileHash = "";
  if (dir) {
    try {
      fileHash = sha256(await Bun.file(join(dir, "package.json")).text());
    } catch {
      /* best-effort integrity — missing file does not fail the gate */
    }
  }
  return sha256([p.name, p.versions?.[0] ?? "", p.license ?? "Unknown", fileHash].join("|"));
}

async function readPreviousSbom(path: string): Promise<{ packages?: SbomEntry[] } | null> {
  try {
    return await Bun.file(path).json();
  } catch {
    return null;
  }
}

function computeDiff(prev: SbomEntry[] | undefined, cur: SbomEntry[]) {
  const keyOf = (e: SbomEntry) => e.name + "@" + e.version;
  const prevKeys = new Set((prev ?? []).map(keyOf));
  const prevByKey = new Map((prev ?? []).map((e) => [keyOf(e), e] as const));
  const added = cur.filter((e) => !prevKeys.has(keyOf(e)));
  const removed = (prev ?? []).filter((e) => !new Set(cur.map(keyOf)).has(keyOf(e)));
  const changed = cur.filter((e) => {
    const before = prevByKey.get(keyOf(e));
    return before !== undefined && (before.reportedLicense !== e.reportedLicense || before.allowed !== e.allowed);
  });
  return { added, removed, changed };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const sbomIdx = args.indexOf("--sbom");
  const sbomMode = sbomIdx >= 0;
  const next = args[sbomIdx + 1];
  const sbomPath = sbomMode && next !== undefined && !next.startsWith("--") ? next : DEFAULT_SBOM_PATH;
  const cfgIdx = args.indexOf("--config");
  const cfgNext = args[cfgIdx + 1];
  const configPath = cfgIdx >= 0 && cfgNext !== undefined && !cfgNext.startsWith("--") ? cfgNext : CONFIG_PATH;

  const proc = Bun.spawnSync(["bun", "pm", "licenses", "--prod", "--json"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout?.toString() ?? "";
  const stderr = proc.stderr?.toString() ?? "";
  const data = parseLicensesOutput(stdout) ?? parseLicensesOutput(stderr);
  if (!data) {
    const msg = "licenses:gate — could not parse bun pm licenses --prod --json output (stdout and stderr are both non-JSON)";
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: msg, stderrTail: stderr.slice(-400) }));
    } else {
      console.error(msg);
      console.error(stderr.slice(-400));
    }
    process.exit(1);
  }

  let policy: LicensePolicy;
  let exemptions: LicenseExemption[];
  try {
    ({ policy, exemptions } = await loadConfig(configPath));
  } catch (err) {
    const msg = "licenses:gate — " + (err instanceof Error ? err.message : String(err));
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    process.exit(1);
  }

  let overlay: AuditOverlay = { advisories: {} };
  const overlayFile = Bun.file(OVERLAY_PATH);
  if (await overlayFile.exists()) {
    try {
      const oerr = validateAuditOverrides(await overlayFile.json());
      if (oerr) throw new Error("config/audit-overrides.json: " + oerr);
      overlay = normalizeAuditOverlay(await overlayFile.json());
    } catch (err) {
      const msg = "licenses:gate — " + (err instanceof Error ? err.message : String(err));
      if (jsonMode) console.log(JSON.stringify({ ok: false, error: msg }));
      else console.error(msg);
      process.exit(1);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const raw: RawPackage[] = [];
  for (const [licenseKey, pkgs] of Object.entries(data)) {
    for (const p of pkgs) raw.push({ ...p, license: p.license ?? licenseKey });
  }

  const evaluated: SbomEntry[] = [];
  for (const p of raw) {
    const version = p.versions?.[0] ?? "?";
    const verdict = evaluatePackage({ name: p.name, version, reportedLicense: p.license ?? "Unknown" }, policy, exemptions, today);
    evaluated.push({ ...verdict, fingerprint: await fingerprintFor(p) });
  }
  const violations = evaluated.filter((e) => !e.allowed);
  const stale = findStaleExemptions(evaluated, exemptions);
  const advisories = evaluated
    .map((e) => ({ e, adv: advisoryFor(e.name, e.version, overlay) }))
    .filter((x) => x.adv !== null)
    .map((x) => ({ name: x.e.name, version: x.e.version, severity: x.adv!.severity, note: x.adv!.note ?? "" }));
  const warnDays = policy.expiryWarningDays ?? 30;
  const expiringSoon = evaluated
    .filter((e) => e.matchedBy === "exemption" && e.expires !== undefined && e.expiresInDays !== undefined && e.expiresInDays <= warnDays)
    .map((e) => ({ name: e.name, version: e.version, expires: e.expires ?? "", expiresInDays: e.expiresInDays ?? 0, reason: e.reason ?? "" }));
  const summary = { total: evaluated.length, allowed: evaluated.length - violations.length, violations: violations.length, exemptions: exemptions.length };
  let diff: ReturnType<typeof computeDiff> | null = null;
  if (sbomMode) {
    const prev = await readPreviousSbom(sbomPath);
    diff = computeDiff(prev?.packages, evaluated);
    const sbom = {
      format: "licenses-sbom",
      version: 1,
      generatedAt: new Date().toISOString(),
      bunVersion: Bun.version,
      summary,
      packages: evaluated,
    };
    await Bun.write(sbomPath, JSON.stringify(sbom, null, 2) + "\n");
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      ok: violations.length === 0,
      generatedAt: new Date().toISOString(),
      bunVersion: Bun.version,
      summary,
      packages: evaluated,
      violations: violations.map((v) => ({ name: v.name, version: v.version, license: v.reportedLicense, reason: v.reason })),
      staleExemptions: stale.map((e) => e.name),
      advisories,
      expiringSoon,
      diff: diff === null ? null : {
        added: diff.added.map((e) => e.name + "@" + e.version),
        removed: diff.removed.map((e) => e.name + "@" + e.version),
        changed: diff.changed.map((e) => e.name + "@" + e.version),
      },
    }, null, 2));
  } else {
    console.log("licenses:gate — " + summary.total + " prod packages: " + summary.allowed + " allowed, " + summary.violations + " violations");
    for (const e of evaluated) {
      const tag = e.allowed ? "ok  " : "FAIL";
      const how = e.matchedBy === "exemption" ? " (exemption: " + (e.reason ?? "") + ")" : e.matchedBy === "allowlist" ? " [" + e.normalizedLicense + "]" : " — " + (e.reason ?? "no allowlist entry");
      console.log("  " + tag + " " + e.name + "@" + e.version + how);
    }
    for (const s of stale) console.log('  warn stale exemption: ' + s.name + ' matches no prod package');
    for (const a of advisories) console.log('  warn advisory ' + a.name + '@' + a.version + ' (' + a.severity + ')' + (a.note ? ' — ' + a.note : ''));
    if (advisories.length) console.log('licenses:gate — ' + advisories.length + ' advisory(ies) from config/audit-overrides.json (warn-only; license policy remains the merge authority)');
    for (const w of expiringSoon) console.log('  warn exemption ' + w.name + ' expires in ' + w.expiresInDays + ' day(s) (' + w.expires + ') — review before it fails the gate');
    if (expiringSoon.length) console.log('licenses:gate — ' + expiringSoon.length + ' exemption(s) inside the ' + warnDays + '-day expiry warning window');
    if (sbomMode && diff !== null) {
      if (sbomPath === DEFAULT_SBOM_PATH) console.log("licenses:gate — sbom written to .data/licenses-sbom.json");
      for (const a of diff.added) console.log("  + added " + a.name + "@" + a.version + " (" + a.normalizedLicense + ")");
      for (const r of diff.removed) console.log("  - removed " + r.name + "@" + r.version);
      for (const c of diff.changed) console.log("  ~ changed " + c.name + "@" + c.version + " (" + c.normalizedLicense + ")");
      if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0)
        console.log("  no dependency drift since last snapshot");
    }
    if (violations.length) {
      for (const v of violations) console.log("  FAIL " + v.name + "@" + v.version + " — " + v.reason);
      console.log("licenses:gate — FAIL (" + violations.length + " violation(s))");
      process.exit(1);
    }
    console.log("licenses:gate — ok (all prod deps permissive or explicitly exempted)");
  }
  if (violations.length) process.exit(1);
}

await main();





