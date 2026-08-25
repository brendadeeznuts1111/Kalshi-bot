#!/usr/bin/env bun
/**
 * bun:coverage-audit — every "not adopted" Bun API row in the BUN_NATIVE
 * topic table must have a recorded decision.
 *
 * Rule: a topic-table row (the "Here" column) is classified unless its cell
 * is exactly "—". Unclassified rows must be documented in the
 * "Not-adopted APIs — recorded decisions" section (matched by Topic name).
 * Exits 1 on any unclassified row — no Bun 1.4 pattern drifts into an
 * undocumented state. Decision refs D1–D13 are in that section.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const text = readFileSync(join(ROOT, "docs/BUN_NATIVE.md"), "utf8");
const lines = text.split("\n");

const START = "## Bun APIs overview (official)";
const END = "## Utils (runtime)";
const DECISIONS = "## Not-adopted APIs — recorded decisions";

const startIdx = lines.findIndex((l) => l.startsWith(START));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.startsWith(END));
const decIdx = lines.findIndex((l) => l.startsWith(DECISIONS));
if (startIdx < 0 || endIdx < 0 || decIdx < 0) {
  console.error("bun:coverage-audit — FAIL: could not locate topic table / decisions section in docs/BUN_NATIVE.md");
  process.exit(1);
}

const decisionsText = lines.slice(decIdx).join("\n");
const unclassified: string[] = [];

for (let i = startIdx + 1; i < endIdx; i++) {
  const line = lines[i]!;
  if (!line.trimStart().startsWith("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  // cells: ['', Topic, GuideAPIs, Ref, Here, ''] (trailing empty)
  const topic = cells[1];
  const here = cells[4] ?? "";
  if (!topic) continue;
  if (here !== "—") continue; // classified (yes / note / probe-only / rare / as needed)
  // unclassified — require the Topic name in the decisions section
  const topicMatch = decisionsText.includes(topic);
  if (!topicMatch) {
    unclassified.push(topic);
  }
}

if (unclassified.length) {
  console.error("bun:coverage-audit — FAIL (" + unclassified.length + " unclassified BUN_NATIVE rows)");
  for (const t of unclassified) console.error("  - " + t + " — record a decision in docs/BUN_NATIVE.md (decisionRef D#)");
  process.exit(1);
}
console.log("bun:coverage-audit — ok · every \u201c—\u201d topic-table row has a recorded decision");
