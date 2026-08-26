#!/usr/bin/env bun
/**
 * bun run shape:gen - generate tools/bun-shape.json: the full-shape
 * ground truth of the pinned Bun runtime (1.4.0), parsed STRUCTURALLY
 * from its bundled bun-types with the TS compiler API (no regex -
 * formatting cannot drift the shape). §168.
 *
 * Emits bunVersion/bunRevision (runtime), pinnedVersion, generatedAt,
 * members (name, ns, kind, typeOnly, docs, extension) and globals.
 * Consumed by tools/shape-probe.ts (freshness gate), the coverage
 * matrix generator, and the per-module shape report.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { listFilesAsync } from "../src/lib/glob.ts"; // Bun.Glob recursive listing (S225)

const ROOT = join(import.meta.dir, "..");
const PINNED_VERSION = "1.4.0";
const OUT = join(ROOT, "tools/bun-shape.json");

// Locate the bundled bun-types for the pinned version (glob the cache
// links dir; the bun-types dir name is 1.4.0-<hash>, which is the
// bun-types PACKAGE version hash, NOT the runtime revision - do not
// assert the hashes match).
const cacheRoot = join(ROOT, "node_modules/.bun-cache/links");
let bundleDir = "";
try {
  bundleDir = readdirSync(cacheRoot)
    .filter((d) => d.startsWith("bun-types@" + PINNED_VERSION + "-"))
    .sort()[0] ?? "";
} catch {
  /* no links dir */
}
if (!bundleDir) {
  console.error("shape:gen: no bundled bun-types@" + PINNED_VERSION + " under " + cacheRoot + " (run bun install)");
  process.exit(1);
}
const BT = join(cacheRoot, bundleDir, "node_modules/bun-types");

interface ShapeMember {
  name: string;
  ns: string;
  kind: string;
  typeOnly: boolean;
  docs: boolean;
  deprecated: boolean;
  extension: boolean;
}

const members: ShapeMember[] = [];
const moduleMembers: Record<string, ShapeMember[]> = {};
const seen = new Set<string>();
const modSeen = new Set<string>();
const keyOf = (ns: string, name: string) => (ns ? ns + "." + name : name);

// bun:* module plane (bun.com/reference module pages: bun:test, bun:sqlite,
// bun:ffi, bun:jsc, bun:bundle - generated from the same bun-types bundle).
const modAdd = (mod: string, ns: string, name: string, kind: string, typeOnly: boolean, dep: boolean) => {
  const k = ns ? mod + "." + ns + "." + name : mod + "." + name;
  if (modSeen.has(k)) return;
  modSeen.add(k);
  if (!moduleMembers[mod]) moduleMembers[mod] = [];
  moduleMembers[mod].push({ name, ns, kind, typeOnly, docs: false, deprecated: dep, extension: false });
};

const walkModBlock = (block: ts.ModuleBlock, mod: string, ns: string, sf: ts.SourceFile, dep: boolean) => {
  for (const st of block.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) modAdd(mod, ns, d.name.getText(sf), "object", false, dep);
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      modAdd(mod, ns, st.name.text, "function", false, dep);
    } else if (ts.isClassDeclaration(st) && st.name) {
      const abstract = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
      modAdd(mod, ns, st.name.text, "class", abstract, dep);
    } else if (ts.isModuleDeclaration(st) && st.name && st.name.text !== "__internal") {
      const innerNs = ns ? ns + "." + st.name.text : st.name.text;
      modAdd(mod, ns, st.name.text, "namespace", false, dep);
      if (st.body && ts.isModuleBlock(st.body)) walkModBlock(st.body, mod, innerNs, sf, dep);
    } else if (ts.isInterfaceDeclaration(st) && st.name) {
      modAdd(mod, ns, st.name.text, "type", true, dep);
    } else if (ts.isTypeAliasDeclaration(st) && st.name) {
      modAdd(mod, ns, st.name.text, "type", true, dep);
    }
  }
};

const add = (ns: string, name: string, kind: string, typeOnly: boolean, dep: boolean) => {
  const k = keyOf(ns, name);
  if (seen.has(k)) return;
  seen.add(k);
  members.push({ name, ns, kind, typeOnly, docs: false, deprecated: dep, extension: false });
};

const walkModuleBlock = (block: ts.ModuleBlock, ns: string, sf: ts.SourceFile, dep: boolean) => {
  for (const st of block.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) add(ns, d.name.getText(sf), "object", false, dep);
    } else if (ts.isFunctionDeclaration(st) && st.name) {
      add(ns, st.name.text, "function", false, dep);
    } else if (ts.isClassDeclaration(st) && st.name) {
      const abstract = st.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
      add(ns, st.name.text, "class", abstract, dep);
    } else if (ts.isModuleDeclaration(st) && st.name && st.name.text !== "__internal") {
      const innerNs = ns ? ns + "." + st.name.text : st.name.text;
      add(ns, st.name.text, "namespace", false, dep);
      if (st.body && ts.isModuleBlock(st.body)) walkModuleBlock(st.body, innerNs, sf, dep);
    } else if (ts.isInterfaceDeclaration(st) && st.name) {
      add(ns, st.name.text, "type", true, dep);
    } else if (ts.isTypeAliasDeclaration(st) && st.name) {
      add(ns, st.name.text, "type", true, dep);
    }
  }
};

for (const f of readdirSync(BT).filter((x) => x.endsWith(".d.ts")).sort()) {
  const text = readFileSync(join(BT, f), "utf8");
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (ts.isModuleDeclaration(st) && st.name && st.name.text === "bun" && st.body && ts.isModuleBlock(st.body)) {
      walkModuleBlock(st.body, "", sf, f === "deprecated.d.ts");
    }
    if (ts.isModuleDeclaration(st) && st.name && st.name.text && st.name.text.startsWith("bun:") && st.body && ts.isModuleBlock(st.body)) {
      walkModBlock(st.body, st.name.text, "", sf, f === "deprecated.d.ts");
    }
  }
}

// Docs flag: bundled mdx mention of the dotted name (Bun.<name>).
// Bun-native recursive listing via listFilesAsync (Bun.Glob) - the old
// readdirSync({ recursive: true }) was the non-Bun walk (S225).
const docTexts: string[] = [];
const collectDocs = async (dir: string) => {
  try {
    const files = await listFilesAsync("**/*.mdx", { cwd: dir, onlyFiles: true });
    for (const rel of files) {
      docTexts.push(await Bun.file(join(dir, rel)).text());
    }
  } catch {
    /* no docs dir */
  }
};
await collectDocs(join(BT, "docs"));
for (const m of members) {
  const full = m.ns ? m.ns + "." + m.name : m.name;
  m.docs = docTexts.some((t) => t.includes("Bun." + full));
}

// Bun.FFI is live but declared in ffi.d.ts outside the module bun
// export set - record it as a documented runtime extension.
if ((Bun as any).FFI !== undefined && !seen.has("FFI")) {
  members.push({ name: "FFI", ns: "", kind: "object", typeOnly: false, docs: docTexts.some((t) => t.includes("Bun.FFI")), deprecated: false, extension: true });
}

// Globals from globals.d.ts (var/function/class/const declarations).
const globals: string[] = [];
const gseen = new Set<string>();
const gfile = join(BT, "globals.d.ts");
if (readdirSync(BT).includes("globals.d.ts")) {
  const text = readFileSync(gfile, "utf8");
  const sf = ts.createSourceFile(gfile, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    let n = "";
    if (ts.isVariableStatement(st)) n = st.declarationList.declarations[0]?.name.getText(sf) ?? "";
    else if (ts.isFunctionDeclaration(st) && st.name) n = st.name.text;
    else if (ts.isClassDeclaration(st) && st.name) n = st.name.text;
    if (n && n !== "Bun" && !gseen.has(n)) {
      gseen.add(n);
      globals.push(n);
    }
  }
}
globals.sort();

members.sort((a, b) => keyOf(a.ns, a.name).localeCompare(keyOf(b.ns, b.name)));

for (const k of Object.keys(moduleMembers)) {
  moduleMembers[k]!.sort((a, b) => keyOf(a.ns, a.name).localeCompare(keyOf(b.ns, b.name)));
}

const shape = {
  bunVersion: Bun.version,
  bunRevision: Bun.revision,
  pinnedVersion: PINNED_VERSION,
  generatedAt: new Date().toISOString(),
  members,
  modules: moduleMembers,
  globals,
};
await Bun.write(OUT, JSON.stringify(shape, null, 2) + "\n");

const top = members.filter((m) => !m.ns).length;
const sub = members.length - top;
const live = Object.keys(Bun).length;
console.log("shape:gen - " + members.length + " members (" + top + " top-level, " + sub + " sub-namespace) + " + globals.length + " globals; runtime live keys: " + live + " -> tools/bun-shape.json");

export {};
