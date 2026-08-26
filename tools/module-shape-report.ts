#!/usr/bin/env bun
/**
 * bun run module-shape:report - per-module Bun usage, annotated with
 * probe-gate + docs status from the full shape (tools/bun-shape.json,
 * §168) and the gate map (src/lib/bun-gates.ts, §170), plus a REAL
 * code example per token (first matching source line, §173).
 * Regenerates docs/BUN_MODULE_SHAPE.md. Offline.
 */
import { join } from "node:path";
import { gateFor } from "../src/lib/bun-gates.ts";

const ROOT = join(import.meta.dir, "..");
const BTK = String.fromCharCode(96);
const shape = await Bun.file(join(ROOT, "tools/bun-shape.json")).json();
const byKey = new Map<string, any>();
const shapeTop = new Set<string>();
for (const m of shape.members) {
  byKey.set(m.ns ? m.ns + "." + m.name : m.name, m);
  if (!m.ns) shapeTop.add(m.name);
}

// bun:* reference module exports (bun:test, bun:sqlite, bun:ffi, bun:jsc,
// bun:bundle - the /reference module plane, §175) + module gates.
const moduleByKey = new Map<string, { module: string; member: any }>();
for (const [mod, list] of Object.entries(shape.modules ?? {})) {
  for (const member of list as any[]) {
    if (!member.typeOnly) moduleByKey.set(member.name, { module: mod, member });
  }
}
const MODULE_GATES: Record<string, string> = {
  "bun:test": "test:probe",
  "bun:sqlite": "sqlite:probe",
  "bun:ffi": "ffi:probe",
  "bun:jsc": "surface:probe",
  "bun:bundle": "build-deep:probe",
};
const resolveGate = (tok: string, m: any): string => {
  if (m) return gateFor(m);
  const mm = moduleByKey.get(tok);
  if (mm) return MODULE_GATES[mm.module] ?? "GAP";
  return "unmapped";
};

// Per-module usage with line numbers + source text (single rg pass;
// Uses = matching source LINES, example = the first matching line).
const scan = Bun.spawnSync(["rg", "-n", "--no-heading", "Bun\.[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?", "src", "tools", "scripts", "tests"], { cwd: ROOT, stdout: "pipe" });
const usage = new Map<string, Map<string, { count: number; example: string }>>();
// Test-fixture writes (write('src/...', ...) in tests) are counted as usage but
// are NOT good examples - the fake path would trip docs:check's pointer rule.
const isFixtureWrite = (text: string) => /write\(\s*['"](?:src|tools|scripts|tests)\//.test(text);
const addUse = (module: string, tok: string, example: string) => {
  if (!usage.has(module)) usage.set(module, new Map());
  const mm = usage.get(module)!;
  const cur = mm.get(tok);
  if (cur) { cur.count += 1; if (!cur.example && example) cur.example = example; }
  else mm.set(tok, { count: 1, example });
};

// Pass 1: Bun.<token> usage (line-based).
const TOKEN_RE = /Bun\.([A-Za-z_$][A-Za-z0-9_$]*)(?:\.([A-Za-z_$][A-Za-z0-9_$]*))?/g;
for (const l of (scan.stdout?.toString() ?? "").split("\n")) {
  if (!l.includes("Bun.")) continue;
  const c1 = l.indexOf(":");
  if (c1 < 0) continue;
  const c2 = l.indexOf(":", c1 + 1);
  if (c2 < 0) continue;
  const path = l.slice(0, c1);
  const text = l.slice(c2 + 1);
  const seg = path.split("/");
  const module = seg.slice(0, -1).join("/") || seg[0]!;
  const matches = [...text.matchAll(TOKEN_RE)];
  if (matches.length === 0) continue;
  for (const m of matches) {
    let tok = m[2] ? m[1]! + "." + m[2] : m[1]!;
    // longest shape-matching key: Bun.argv.includes is usage of argv.
    if (tok.includes(".") && !byKey.has(tok)) tok = tok.split(".")[0]!;
    addUse(module, tok, isFixtureWrite(text) ? "" : text);
  }
}

// Pass 2: named imports from "bun" + bun:* modules (alias-resolved to the
// real member name; type imports count as usage too) - §175.
const IMP_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"(bun|bun:[a-z-]+)"/g;
const impScan = Bun.spawnSync(["rg", "-n", "--no-heading", "from \"(bun|bun:[a-z-]+)\"", "src", "tools", "scripts", "tests"], { cwd: ROOT, stdout: "pipe" });
for (const l of (impScan.stdout?.toString() ?? "").split("\n")) {
  const c1 = l.indexOf(":");
  if (c1 < 0) continue;
  const c2 = l.indexOf(":", c1 + 1);
  if (c2 < 0) continue;
  const path = l.slice(0, c1);
  const text = l.slice(c2 + 1);
  const seg = path.split("/");
  const module = seg.slice(0, -1).join("/") || seg[0]!;
  for (const m of text.matchAll(IMP_RE)) {
    const source = m[2];
    for (const part of m[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]!.trim();
      if (!name) continue;
      if (source === "bun") {
        const mem = byKey.get(name);
        if (mem && !mem.ns) addUse(module, name, text);
      } else if (moduleByKey.has(name)) {
        addUse(module, name, text);
      }
    }
  }
}

const liveNames = new Set(Object.keys(Bun));
const clean = (s: string) => {
  const t = s.trim();
  // Keep the Bun. prefix only for LIVE runtime members: placeholder tokens
  // (Bun.Foo, Bun.x) and type-only namespaces (Bun.Security, Bun.ArchiveInput)
  // in quoted source must not reach docs:api STRICT (§173).
  const unp = t
    .replace(/Bun\.([A-Za-z_$][A-Za-z0-9_$]*)/g, (_m, n: string) => (liveNames.has(n) ? "Bun." + n : n))
    // escape markdown image syntax (![alt](src)) so the assets gate does
    // not resolve quoted source as a real image ref (§174)
    .replace(/!\[/g, "!\\[");
  if (unp.length <= 110) return unp.replace(/\|/g, "\\|");
  const cut = unp.slice(0, 110);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/\|/g, "\\|") + "...";
};

const modules = [...usage.keys()].sort();
const md: string[] = [
  "# Bun usage by module",
  "",
  "Regenerated by " + BTK + "bun run module-shape:report" + BTK + " (tools/module-shape-report.ts, §170).",
  "Per-module " + BTK + "Bun.*" + BTK + " usage + from-bun and bun:* named-import",
  "usage (the /reference module plane, §175), annotated with the probe",
  "gate, docs status, and a REAL code example (first matching source line,",
  "§173). Uses = matching source lines. Gate = GAP means used-but-unprobed",
  "(a Tier-A failure in the matrix). unmapped = prose/placeholder/non-",
  "existent API mentions - review-only.",
  "",
];
for (const mod of modules) {
  const toks = [...usage.get(mod)!.entries()].sort((a, b) => b[1].count - a[1].count);
  md.push("## " + mod);
  md.push("");
  md.push("| Token | Uses | Gate | Docs | Example |");
  md.push("|---|---|---|---|---|");
  for (const [tok, u] of toks) {
    const m = byKey.get(tok);
    const gate = resolveGate(tok, m);
    const docs = m ? (m.docs ? "y" : "n") : moduleByKey.has(tok) ? "y" : "?";
    md.push("| " + BTK + tok + BTK + " | " + u.count + " | " + gate + " | " + docs + " | " + (u.example ? clean(u.example) : "—") + " |");
  }
  md.push("");
}
await Bun.write(join(ROOT, "docs/BUN_MODULE_SHAPE.md"), md.join("\n") + "\n");
console.log("module-shape report regenerated: " + modules.length + " modules with code examples");

export {};
