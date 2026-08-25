#!/usr/bin/env bun
/**
 * routes:check — the route-manifest contract gate.
 *
 * 1. Consistency: every manifest entry has a unique path, a valid method
 *    and a valid integration layer.
 * 2. Coverage: every literal pathname served by serve.ts (url.pathname ===
 *    / .startsWith, the Bun.serve routes-map keys, and the /bun/* widget
 *    keys) must be covered by the manifest — exact, wildcard ("/*") or
 *    pattern static-prefix ("/x/:id" covers "/x/...").
 *
 * A new route in serve.ts that is not registered in route-manifest.ts
 * fails this gate — the API surface stays documented by construction.
 *
 * NOTE (probe): Bun 1.4.0's regex lexer chokes on a bare "/" inside a
 * group when the literal also contains quotes ( /"(\/[^"]+)"/ parses,
 * /"(/[^"]+)"/ throws "Unexpected ^" ). This tool uses new RegExp with
 * String.raw patterns to sidestep the lexer entirely.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROUTE_MANIFEST, type RouteDef } from "../src/research/route-manifest.ts";

const ROOT = join(import.meta.dir, "..");
const SERVE_PATH = join(ROOT, "src/research/serve.ts");
const serveSrc = readFileSync(SERVE_PATH, "utf8");

const LAYERS = new Set(['channels', 'branding', 'pipeline', 'data', 'ops', 'trading', 'research']);
const METHODS = new Set(['GET', 'POST', 'GET|POST']);

function patternCovers(r: RouteDef, p: string): boolean {
  if (r.path === p) return true;
  if (r.path.endsWith('/*')) return p.startsWith(r.path.slice(0, -1));
  if (r.path.includes(':') || r.path.includes('<')) {
    const prefix = r.path.split(/[:<]/)[0]!;
    return prefix.length > 0 && p.startsWith(prefix);
  }
  return false;
}

const problems: string[] = [];

// 1. consistency --------------------------------------------------------
const byPath = new Map<string, string>();
for (const r of ROUTE_MANIFEST) {
  if (!METHODS.has(r.method)) problems.push('invalid method ' + r.method + ' for ' + r.path);
  if (!LAYERS.has(r.layer)) problems.push('invalid layer ' + r.layer + ' for ' + r.path);
  const prev = byPath.get(r.path);
  if (prev !== undefined) problems.push('duplicate path ' + r.path + ' (' + prev + ' + ' + r.handler + ')');
  else byPath.set(r.path, r.handler);
  if (!r.handler) problems.push('missing handler for ' + r.path);
}

// 2. coverage: collect every literal pathname served by serve.ts ---------
const collected = new Set<string>();
for (const m of serveSrc.matchAll(new RegExp(String.raw`url\.pathname\s*===\s*"([^"]+)"`, 'g'))) collected.add(m[1]!);
for (const m of serveSrc.matchAll(new RegExp(String.raw`url\.pathname\.startsWith\("([^"]+)"\)`, 'g'))) collected.add(m[1]!);
// Bun.serve routes-map literal keys (skip dynamic ROUTES.* keys)
for (const m of serveSrc.matchAll(new RegExp(String.raw`^\s*"(\/[^"]+)":`, 'gm'))) collected.add(m[1]!);
// BUN_WIDGETS keys
for (const m of serveSrc.matchAll(new RegExp(String.raw`"(\/bun\/[a-z-]+)":`, 'g'))) collected.add(m[1]!);

const missing: string[] = [];
for (const p of [...collected].sort()) {
  if (!ROUTE_MANIFEST.some((r) => patternCovers(r, p))) missing.push(p);
}

for (const p of missing) problems.push('serve.ts serves ' + p + ' but route-manifest.ts has no covering entry');

if (problems.length) {
  console.error('routes:check — FAIL (' + problems.length + ')');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('routes:check — ok · ' + ROUTE_MANIFEST.length + ' manifest entries · ' + collected.size + ' served pathnames covered');
