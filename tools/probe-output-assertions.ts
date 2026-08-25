#!/usr/bin/env bun
/**
 * probe-output-assertions.ts — GROUNDING probe for semantic output
 * verification (docs-output-check proposal, AGENT-PITFALLS §64).
 *
 * Scans docs/*.md + src/research/*-page.ts for fenced code blocks whose
 * LAST line carries an output assertion comment:
 *   // => 123
 *   // => { a: 1 }
 *   // expected: ...
 *   // ⇒ ...
 *
 * Outputs a classification table (primitive / object / multi-line /
 * error / non-deterministic / illustrative) and writes
 * .data/output-probe.md. The DECISION to build a full gate comes from
 * this data: enough real signal + manageable false-positive risk.
 *
 * @see docs/AGENT-PITFALLS.md §64 (pending)
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeDocsGateState } from "../src/lib/docs-state.ts";

const ROOT = join(import.meta.dir, "..");

type Assertion = {
  file: string;
  line: number;
  lang: string;
  marker: string; // '=>' | 'expected:' | '⇒'
  raw: string;
  code: string;
  kind: string;
  risky: string[];
};

function classify(raw: string, code: string, marker: string): { kind: string; risky: string[] } {
  const risky: string[] = [];
  const r = raw.trim();
  const rl = r.toLowerCase();
  // non-deterministic markers
  if (/\b(date|time|now|random|uuid|pid|port|duration|ms|elapsed)\b/i.test(rl)) risky.push("non-deterministic");
  if (/\bhttp:\/\/localhost|server listening|\bstarted\b/i.test(rl)) risky.push("env/port-dependent");
  if (r.includes("...") || r.endsWith("...") || /…$/.test(r)) risky.push("elision");
  if (/\bundefined\b|\bnull\b/.test(rl)) risky.push("undefined/null");
  if (/^[\"\u0027]/.test(r) && /error|exception|throw/i.test(r)) risky.push("error-string");
  // kind
  if (/^[{[]/.test(r)) return { kind: "object/array", risky };
  if (/^[\"\u0027]/.test(r)) return { kind: "string", risky };
  if (/^\d+(\.\d+)?(n|m|s|ms)?$/.test(r) || /^-?\d/.test(r)) return { kind: "number", risky };
  if (/^(true|false)$/i.test(r)) return { kind: "boolean", risky };
  if (/^\d{4,}-\d{2}-\d{2}/.test(r)) return { kind: "date", risky: [...risky, "non-deterministic"] };
  if (/^<[a-z][^>]*>$/i.test(r)) return { kind: "html-tag", risky };
  if (/error|exception|throw/i.test(rl)) return { kind: "error-message", risky };
  if (/^[A-Za-z0-9_]+$/.test(r)) return { kind: "identifier", risky };
  return { kind: "unclassified", risky };
}

/** Extract fenced blocks with their last-line assertions. */
function extractAssertions(text: string, file: string): Assertion[] {
  const out: Assertion[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const open = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(lines[i]!);
    if (open) {
      const lang = open[2] || "";
      const start = i + 1;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*(```|~~~)\s*$/.test(lines[i]!)) { buf.push(lines[i]!); i++; }
      // look for assertion comment on the last non-empty line(s)
      for (let j = buf.length - 1; j >= 0; j--) {
        const line = buf[j]!.trim();
        const m = /^\/\/\s*(=>|expected:|⇒)\s*(.+)$/.exec(line);
        if (m) {
          const code = buf.slice(0, j).join("\n");
          const { kind, risky } = classify(m[2]!, code, m[1]!);
          out.push({ file, line: start + j, lang, marker: m[1]!, raw: m[2]!, code, kind, risky });
          break;
        }
        // stop scanning backwards past non-comment code
        if (!/^\s*\/\//.test(line) && line.length > 0) break;
      }
      continue;
    }
    i++;
  }
  return out;
}

async function main() {
  console.log("output-assertion probe — bun " + Bun.version);
  const all: Assertion[] = [];
  for (const f of new Bun.Glob("*.md").scanSync({ cwd: join(ROOT, "docs"), onlyFiles: true })) {
    all.push(...extractAssertions(readFileSync(join(ROOT, "docs", f), "utf8"), f));
  }
  for (const f of new Bun.Glob("*page.ts").scanSync({ cwd: join(ROOT, "src/research"), onlyFiles: true })) {
    all.push(...extractAssertions(readFileSync(join(ROOT, "src/research", f), "utf8"), f));
  }
  // stats
  const byKind = new Map<string, number>();
  let risky = 0;
  let jsFamily = 0;
  for (const a of all) {
    byKind.set(a.kind, (byKind.get(a.kind) || 0) + 1);
    if (a.risky.length) risky++;
    if (["js", "jsx", "ts", "tsx", "typescript"].includes(a.lang.toLowerCase())) jsFamily++;
  }
  console.log("TOTAL assertions: " + all.length);
  console.log("by kind: " + [...byKind.entries()].map(([k, n]) => k + "=" + n).join(" · "));
  console.log("JS-family blocks: " + jsFamily + " · risky (non-deterministic/elision/env): " + risky);
  console.log("---");
  // sample of each kind
  const shown = new Set<string>();
  for (const a of all) {
    if (shown.has(a.kind)) continue;
    shown.add(a.kind);
    console.log("SAMPLE [" + a.kind + "] " + a.file + ":" + a.line + " " + a.lang + "  => " + a.raw.trim().slice(0, 60));
  }
  // all risky
  console.log("--- RISKY (" + risky + "):");
  for (const a of all.filter((x) => x.risky.length).slice(0, 12)) {
    console.log("  " + a.file + ":" + a.line + " [" + a.risky.join(",") + "] " + a.raw.trim().slice(0, 60));
  }
  // write report
  const md: string[] = ["# Output-assertion probe — Bun " + Bun.version, "",
    "Total: " + all.length + " · by kind: " + [...byKind.entries()].map(([k, n]) => k + "=" + n).join(", "), "",
    "| file | line | kind | raw | risky |", "|---|---|---|---|---|"];
  for (const a of all) {
    md.push("| " + a.file + " | " + a.line + " | " + a.kind + " | `" + a.raw.trim().slice(0, 50).replace(/\|/g, "\\|") + "` | " + a.risky.join(",") + " |");
  }
  await Bun.write(join(ROOT, ".data", "output-probe.md"), md.join("\n") + "\n");
  await writeDocsGateState("output-state.json", { ok: all.length === 0, fails: all.length, assertions: all.length, risky, jsFamily });
  console.log("report: .data/output-probe.md");
}

await main();