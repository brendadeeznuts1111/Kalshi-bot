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
 * Run manually (bun run audit:overlay:update), or scheduled in-process by
 * cron-main (AUDIT_OVERLAY_UPDATE=1, §99). The exported
 * refreshAuditOverlay() throws on failure so a cron caller can catch — it
 * never process.exit()s (that would kill the cron process).
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

export async function refreshAuditOverlay(): Promise<{ found: number; total: number }> {
  const proc = Bun.spawnSync(["bun", "audit", "--json"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const stdout = proc.stdout?.toString() ?? "";
  const stderr = proc.stderr?.toString() ?? "";
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("audit:overlay:update — bun audit --json output was not JSON (network or toolchain issue)\n" + stderr.slice(-400));
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
    throw new Error("audit:overlay:update — generated overlay invalid: " + verr);
  }
  await Bun.write(OVERLAY_PATH, JSON.stringify(overlay, null, 2) + "\n");
  console.log("audit:overlay:update — " + foundKeys.length + " issue(s) from bun audit; wrote config/audit-overrides.json (" + Object.keys(existing).length + " total entries)");
  return { found: foundKeys.length, total: Object.keys(existing).length };
}

async function cliMain(): Promise<void> {
  try {
    await refreshAuditOverlay();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (import.meta.main) await cliMain();
