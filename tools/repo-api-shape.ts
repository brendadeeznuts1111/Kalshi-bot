#!/usr/bin/env bun
/**
 * bun run repo-api:shape - ground the repo's OWN API surface in the Bun
 * shape (§174): every ROUTE_MANIFEST entry mapped to its handler's Bun
 * usage, traced through its called functions (resolution-only BFS:
 * same-file helpers + imported modules, depth-capped), plus global Web
 * APIs (fetch, WebSocket, crypto...), with probe-gate + docs status
 * from the full shape. The trading layer is the compliance-gated
 * authorized-execution surface (docs/AUTHORIZED_EXECUTION.md).
 * Regenerates docs/REPO_API_BUN.md. Offline, no spawn.
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { ROUTE_MANIFEST } from "../src/research/route-manifest.ts";
import { gateFor } from "../src/lib/bun-gates.ts";

const ROOT = join(import.meta.dir, "..");
const BTK = String.fromCharCode(96);
const shape = await Bun.file(join(ROOT, "tools/bun-shape.json")).json();
const byKey = new Map<string, any>();
for (const m of shape.members) byKey.set(m.ns ? m.ns + "." + m.name : m.name, m);

// File-level handler index: fileRel -> fnName -> body span text (parsed once).
const handlerCache = new Map<string, Map<string, string | null>>();
function cachedBody(fileRel: string, fn: string): string | null {
  let m = handlerCache.get(fileRel);
  if (!m) {
    m = new Map();
    handlerCache.set(fileRel, m);
    const path = join(ROOT, fileRel);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    const sf = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name && n.body) m!.set(n.name.text, text.slice(n.body.getStart(sf), n.body.end));
      else if (ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) {
          const init = d.initializer;
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            m!.set(d.name.getText(sf), text.slice(init.getStart(sf), init.end));
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return m.get(fn) ?? null;
}

// Resolve an imported identifier to a repo-relative module path.
function resolveImport(fileRel: string, target: string): string | null {
  const path = join(ROOT, fileRel);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const sf = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const dir = fileRel.slice(0, Math.max(fileRel.lastIndexOf("/"), 0));
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    const spec = st.moduleSpecifier.getText(sf).replace(/['"]/g, "");
    if (!spec.startsWith(".")) continue;
    let matched = false;
    const ic = st.importClause;
    if (ic) {
      if (ic.name && ic.name.text === target) matched = true;
      const nb = ic.namedBindings;
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) if (el.name.text === target) matched = true;
      } else if (nb && ts.isNamespaceImport(nb) && nb.name.text === target) {
        matched = true;
      }
    }
    if (!matched) continue;
    const parts = (dir ? dir.split("/") : []).concat(spec.split("/"));
    const out: string[] = [];
    for (const p of parts) {
      if (p === "..") out.pop();
      else if (p === "." || p === "") continue;
      else out.push(p);
    }
    const base = out.join("/");
    for (const cand of [base + ".ts", base]) {
      try {
        readFileSync(join(ROOT, cand), "utf8");
        return cand;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

const TOKEN_RE = /Bun\.([A-Za-z_$][A-Za-z0-9_$]*)(?:\.([A-Za-z_$][A-Za-z0-9_$]*))?/g;
function tokensIn(span: string): string[] {
  const out = new Set<string>();
  for (const m of span.matchAll(TOKEN_RE)) {
    let tok = m[2] ? m[1]! + "." + m[2] : m[1]!;
    if (tok.includes(".") && !byKey.has(tok)) tok = tok.split(".")[0]!;
    out.add(tok);
  }
  return [...out];
}

const CALL_RE = /[A-Za-z_$][A-Za-z0-9_$]*\s*\(/g;
const SKIP_CALLS = new Set(["if", "for", "while", "switch", "catch", "typeof", "function", "return", "new", "await"]);
function callIdentifiers(span: string): string[] {
  const out = new Set<string>();
  for (const m of span.matchAll(CALL_RE)) {
    const at = m.index ?? 0;
    if (at > 0 && span[at - 1] === ".") continue; // method call, not a bare fn
    const name = m[0].replace(/\s*\($/, "").trim();
    if (!SKIP_CALLS.has(name) && /^[A-Za-z_$]/.test(name)) out.add(name);
  }
  return [...out];
}

// Global Web APIs (value globals from the shape, curated subset).
const GLOBALS = ["fetch", "WebSocket", "EventSource", "crypto", "atob", "btoa", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask", "structuredClone", "AbortController", "Blob", "FormData", "Headers", "Request", "Response", "ReadableStream", "WritableStream", "TransformStream", "TextEncoder", "TextDecoder", "URL", "URLSearchParams", "performance", "console", "navigator", "BroadcastChannel", "MessageChannel", "MessagePort"];
function globalsIn(span: string): string[] {
  const out = new Set<string>();
  for (const g of GLOBALS) {
    if (new RegExp("\\b" + g + "\\b").test(span)) out.add(g);
  }
  return [...out];
}

/** Trace a handler: body tokens + called-function tokens (resolution-only BFS). */
function traceHandler(route: { handler: string; docRef?: string }): { tokens: string[]; globals: string[]; chain: string[] } {
  const name = route.handler;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return { tokens: [], globals: [], chain: [] };
  const files = typeof route.docRef === "string" && route.docRef.endsWith(".ts") ? [route.docRef] : ["src/research/serve.ts"];
  let file = "";
  for (const f of files) {
    if (cachedBody(f, name) !== null) {
      file = f;
      break;
    }
  }
  if (!file) return { tokens: [], globals: [], chain: [] };
  const tokens = new Set<string>();
  const globals = new Set<string>();
  const chain: string[] = [];
  const visited = new Set<string>();
  const queue: Array<{ file: string; fn: string }> = [{ file, fn: name }];
  while (queue.length && visited.size < 24 && chain.length < 12) {
    const cur = queue.shift()!;
    const key = cur.file + "#" + cur.fn;
    if (visited.has(key)) continue;
    const body = cachedBody(cur.file, cur.fn);
    if (body === null) continue; // unresolvable call: not traced
    visited.add(key);
    if (!chain.includes(cur.fn)) chain.push(cur.fn);
    for (const t of tokensIn(body)) tokens.add(t);
    for (const g of globalsIn(body)) globals.add(g);
    const next: Array<{ file: string; fn: string }> = [];
    for (const call of callIdentifiers(body)) {
      if (chain.length >= 15 || visited.size >= 30) break;
      if (cachedBody(cur.file, call) !== null) {
        next.push({ file: cur.file, fn: call });
      } else {
        const imp = resolveImport(cur.file, call);
        if (imp) next.push({ file: imp, fn: call });
      }
    }
    // imported modules first: reach the execution layer before local helpers
    next.sort((a, b) => (a.file === cur.file ? 1 : 0) - (b.file === cur.file ? 1 : 0));
    for (const n of next) queue.push(n);
  }
  return { tokens: [...tokens].sort(), globals: [...globals].sort(), chain: chain.slice(0, 12) };
}

const layers = [...new Set(ROUTE_MANIFEST.map((r) => r.layer))];
const md: string[] = [
  "# Repo API - Bun shape grounding",
  "",
  "Regenerated by " + BTK + "bun run repo-api:shape" + BTK + " (tools/repo-api-shape.ts, §174).",
  "Every ROUTE_MANIFEST entry mapped to its handler's Bun usage, traced",
  "through its called functions (resolution-only BFS: same-file helpers +",
  "imported modules), plus global Web APIs (fetch, WebSocket, crypto...),",
  "with probe-gate + docs status from the full shape (",
  BTK + "tools/bun-shape.json" + BTK + ", §168). GAP = used-but-unprobed",
  "(Tier-A). descriptive = handler is a prose label (no direct scan).",
  "The trading layer is the compliance-gated authorized-execution surface",
  "(docs/AUTHORIZED_EXECUTION.md).",
  "",
];
for (const layer of layers) {
  const routes = ROUTE_MANIFEST.filter((r) => r.layer === layer);
  const allTokens = new Set<string>();
  md.push("## " + layer + " (" + routes.length + " routes)");
  md.push("");
  md.push("| Route | Method | Handler (traced) | Bun APIs + globals |");
  md.push("|---|---|---|---|");
  for (const route of routes) {
    const { tokens, globals, chain } = traceHandler(route);
    for (const t of tokens) allTokens.add(t);
    const cells = tokens.map((t) => {
      const m = byKey.get(t);
      return BTK + t + BTK + (m ? " (" + gateFor(m) + ")" : "");
    }).concat(globals.map((g) => BTK + g + BTK + " (global)"));
    const chainNote = chain.length > 1 ? " [traced: " + chain.join(" -> ") + "]" : "";
    md.push("| " + BTK + route.path + BTK + " | " + route.method + " | " + route.handler + chainNote + " | " + cells.join(", ") + " |");
  }
  md.push("");
  md.push("**Layer summary:** " + routes.length + " routes, " + allTokens.size + " distinct Bun APIs used by traced handlers.");
  md.push("");
}
await Bun.write(join(ROOT, "docs/REPO_API_BUN.md"), md.join("\n") + "\n");
console.log("repo-api shape regenerated: " + ROUTE_MANIFEST.length + " routes across " + layers.length + " layers -> docs/REPO_API_BUN.md");

export {};
