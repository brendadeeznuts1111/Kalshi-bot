#!/usr/bin/env bun
/**
 * `bun run licenses:gate` — license-compliance gate for the production
 * dependency set (AGENT-PITFALLS §92). Turns licenses:check into a
 * verify:contracts gate: fails when a prod dep has a license outside the
 * permissive allowlist, or an Unknown license that is not explicitly
 * allowed (vendored/repo-owned).
 *
 * Allowlist: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD,
 * Unlicense, CC0-1.0 — permissive only.
 *
 * Vendor exception: @factorywager/proton-pass is vendored (file:vendor/)
 * with no license field (bun pm licenses reports Unknown) — deliberate.
 *
 * Exit 1 when a prod dep violates the policy.
 *
 * @see docs/AGENT-PITFALLS.md §92
 */
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Permissive licenses the repo accepts. */
const ALLOWED_LICENSES = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0",
]);

/** Vendored + repo-owned packages with no declared license (deliberate). */
const VENDOR_ALLOWED = new Set(["@factorywager/proton-pass"]);

async function main() {
  const proc = Bun.spawnSync(["bun", "pm", "licenses", "--prod", "--json"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const text = proc.stdout?.toString() ?? "";
  const jsonStart = text.indexOf("{");
  let data: Record<string, Array<{ name: string; versions?: string[]; license?: string }>> = {};
  try { data = JSON.parse(text.slice(jsonStart)); } catch {
    console.error("licenses:gate — could not parse bun pm licenses output");
    process.exit(1);
  }
  const violations: string[] = [];
  const allowed = new Set<string>();
  for (const [license, pkgs] of Object.entries(data)) {
    for (const p of pkgs) {
      if (ALLOWED_LICENSES.has(license)) { allowed.add(p.name); continue; }
      if (license === "Unknown" && VENDOR_ALLOWED.has(p.name)) { allowed.add(p.name); continue; }
      violations.push(p.name + " (" + license + ", " + (p.versions ?? []).join("/") + ")");
    }
  }
  const all = Object.values(data).flat().map((p) => p.name);
  console.log("licenses:gate — " + all.length + " prod packages: " + allowed.size + " allowed, " + violations.length + " violations");
  if (violations.length) {
    for (const v of violations) console.log("FAIL " + v);
    process.exit(1);
  }
  console.log("  allowed: " + [...allowed].sort().join(", "));
  console.log("licenses:gate — ok (all prod deps permissive or vendored)");
}

await main();