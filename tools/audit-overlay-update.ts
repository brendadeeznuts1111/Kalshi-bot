#!/usr/bin/env bun
/**
 * `bun run audit:overlay:update` — refresh config/audit-overrides.json from
 * `bun audit --json` (the ONE place network is allowed for the overlay; the
 * licenses:gate itself never calls the network — §94).
 *
 * Shape-tolerant parser: bun audit --json returns {} when clean and a
 * package map when it finds issues; the extractor accepts a flat
 * { pkg@version: severity }, { pkg@version: { severity, note? } }, or a
 * nested { vulnerabilities: <map> }. Existing manual entries are
 * preserved; found issues are upserted.
 *
 * Run manually or on a schedule — the license gate stays offline + fast.
 */
import { join } from "node:path";
import { validateAuditOverrides } from "../src/lib/licenses-policy.ts";

const ROOT = join(import.meta.dir, "..");
const OVERLAY_PATH = join(ROOT, "config", "audit-overrides.json");

function extractVulns(raw: unknown): Record<string, unknown> {
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== "object") return {};
  const nested = obj.vulnerabilities;
  if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  return obj;
}

async function main() {
  const proc = Bun.spawnSync(["bun", "audit", "--json"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout?.toString() ?? "";
  const stderr = proc.stderr?.toString() ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    console.error("audit:overlay:update — bun audit --json output was not JSON (network or toolchain issue)");
    console.error(stderr.slice(-400));
    process.exit(1);
  }
  const found = extractVulns(raw);
  const foundKeys = Object.keys(found);
  let existing: Record<string, unknown> = {};
  const existingFile = Bun.file(OVERLAY_PATH);
  if (await existingFile.exists()) {
    try {
      const ex = await existingFile.json();
      existing = (ex as { advisories?: Record<string, unknown> }).advisories ?? {};
    } catch {
      /* corrupted overlay — rebuild from scratch */
    }
  }
  for (const [k, v] of Object.entries(found)) existing[k] = v;
  const overlay = { format: "audit-overrides", version: 1, advisories: existing };
  const verr = validateAuditOverrides(overlay);
  if (verr) {
    console.error("audit:overlay:update — generated overlay invalid: " + verr);
    process.exit(1);
  }
  await Bun.write(OVERLAY_PATH, JSON.stringify(overlay, null, 2) + "\n");
  console.log("audit:overlay:update — " + foundKeys.length + " issue(s) from bun audit; wrote config/audit-overrides.json (" + Object.keys(existing).length + " total entries)");
}

await main();
