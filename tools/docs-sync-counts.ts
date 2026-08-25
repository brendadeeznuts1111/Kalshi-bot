#!/usr/bin/env bun
/**
 * `bun run docs:sync-counts` — AUTO-update the AGENT-PITFALLS header
 * verify:contracts N/N from the actual gates array (no manual bumps).
 */
import { join } from "node:path";
const ROOT = join(import.meta.dir, "..");
const vc = await Bun.file(join(ROOT, "tools/verify-contracts.ts")).text();
let count = 0;
for (const line of vc.split("\n")) {
  const t = line.trim();
  if (t.startsWith("[") && t.charCodeAt(1) === 39) count += 1;
}
const pit = await Bun.file(join(ROOT, "docs/AGENT-PITFALLS.md")).text();
const current = count + "/" + count;
const re = new RegExp("verify:contracts \\d+/\\d+");
const next = pit.replace(re, "verify:contracts " + current);
if (next !== pit) {
  await Bun.write(join(ROOT, "docs/AGENT-PITFALLS.md"), next);
  console.log("header count synced to", current);
} else {
  console.log("header count already current", current);
}
process.exit(0);
