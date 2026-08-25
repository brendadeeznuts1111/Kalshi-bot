#!/usr/bin/env bun
/**
 * `bun run docs:api` — validate every `Bun.<token>` mentioned in the repo's
 * markdown against the INSTALLED runtime (probe discipline, AGENT-PITFALLS
 * §62). A doc that mentions `Bun.zstd` when the runtime only has
 * `Bun.zstdCompressSync` is a real drift — this tool catches it.
 *
 * Approach:
 *   - scan docs/*.md + src/research/*-page.ts for /\bBun\.([A-Za-z_$][A-Za-z0-9_$]*)\b/
 *   - probe each token with `typeof Bun[t]` in ONE process (no spawn loop)
 *   - cache results in .data/api-cache.json keyed by Bun.version (offline
 *     re-runs reuse the cache until the runtime changes)
 *   - MISSING tokens that are NOT allowlisted are reported as FAIL
 *
 * Allowlist buckets (probe-classified §62):
 *   - INTENTIONAL: docs document a NON-existent API on purpose (e.g.
 *     Bun.ffi namespace, Bun.html invented claim, Bun.SourceMap undefined)
 *   - TYPE_ONLY: bun-types type namespaces (Bun.Serve.Options,
 *     Bun.WebSocketOptions, Bun.File type) — not runtime values
 *   - PROSE: section titles / prose fragments (Bun.Networking blog name,
 *     Bun.S / Bun.X placeholders)
 *   - WILDCARD: `Bun.readableStreamTo*()` family notation — prefix is a
 *     documented family, the * expands to real members
 *
 * STRICT=1 adds CALLABILITY checks: a `Bun.tok(...)` call-site or
 * `new Bun.tok(...)` site on a MISSING (undefined) token is a FAIL. Object
 * namespaces (Bun.JSON5 / Bun.TOML / Bun.markdown) used in prose with a
 * space-paren are NOT flagged (they exist; the paren is prose).
 *
 * Param-count validation was REJECTED after probing (§62): 13/41 call
 * tokens are overloaded (file=7, hash=9, write=5) and docs abbreviate
 * args (Bun.file(path), Bun.serve({...})) — regex param matching is a
 * false-positive machine. STRICT stops at callability, which is noise-free.
 *
 * Always writes .data/api-report.md: classification table + STRICT
 * callability findings (dashboard channel input).
 *
 * Exit 1 only for UNALLOWED missing tokens (genuine drift), or STRICT
 * callability fails when STRICT=1.
 *
 * @see docs/AGENT-PITFALLS.md §62
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeDocsGateState } from "../src/lib/docs-state.ts";

const ROOT = join(import.meta.dir, "..");
const TOKEN_RE = /\bBun\.([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
const STRICT = process.env.STRICT === "1";

// ─── Allowlists (probe-classified §62) ────────────────────────────────
/** Docs intentionally documenting a NON-existent API (probe-verified). */
const INTENTIONAL = new Set([
  "ffi", // §27: Bun.ffi NAMESPACE does not exist — module is bun:ffi
  "html", // §38/§62: Bun.html declarative streaming is INVENTED (typeof undefined)
  "SourceMap", // §62: Bun.SourceMap undefined, bun:jsc undefined
  "term", // §62: Bun.term UNDEFINED (no cursorTo/clearDown)
  "rename", // §62: no Bun-native rename — node:fs renameSync is the path
  "S", // §62: Bun.S undefined (blog code identifier unresolved)
  "X", // §62: Bun.X placeholder in a probe writeup
  "watch", // §62: NO Bun.watch API — content:watch is the bun --watch CLI flag
  "CSV", // §69: no Bun.CSV in 1.4.0 (probe) — custom parser is the native answer
  "zstd", // §62: no Bun.zstd — real APIs are zstdCompressSync/zstdDecompressSync
  "image", // §12: lowercase form documented as non-existent (the API is Bun.Image capital)
]);
/** bun-types TYPE namespaces — not runtime values; typeof check is wrong for these. */
const TYPE_ONLY = new Set([
  "Serve", // Bun.Serve.Options type (serve.ts uses the type, not a value)
  "WebSocketOptions", // proxy/TLS types derive from Bun.WebSocketOptions (type)
  "File", // archive.files() returns Map<string, Bun.File> — the TYPE, not Bun.file()
]);
/** Prose fragments / section titles that are NOT API mentions. */
const PROSE = new Set([
  "Networking", // §15 heading: "Bun.Networking claims" = blog section name
]);
/** `Bun.<prefix>*` wildcard family notation — expand members instead of failing. */
const WILDCARD_FAMILIES = new Set([
  "readableStreamTo", // Bun.readableStreamToArrayBuffer/Array/Blob/JSON/Text
]);

type TokenMeta = { count: number; files: string[] };
type CallMeta = { call: number; news: number; files: string[] };

/** Scan markdown + widget pages for Bun.<token> mentions + call-sites. */
function collectTokens(): { out: Map<string, TokenMeta>; callSites: Map<string, CallMeta> } {
  const out = new Map<string, TokenMeta>();
  const callSites = new Map<string, CallMeta>();
  const add = (tok: string, file: string) => {
    const e = out.get(tok);
    if (e) { e.count++; if (!e.files.includes(file)) e.files.push(file); }
    else out.set(tok, { count: 1, files: [file] });
  };
  const noteCall = (tok: string, file: string, isNew: boolean) => {
    const e = callSites.get(tok) || { call: 0, news: 0, files: [] };
    if (isNew) e.news++; else e.call++;
    if (!e.files.includes(file)) e.files.push(file);
    callSites.set(tok, e);
  };
  const scan = (text: string, file: string) => {
    for (const m of text.matchAll(TOKEN_RE)) add(m[1]!, file);
    for (const m of text.matchAll(/\bBun\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) noteCall(m[1]!, file, false);
    for (const m of text.matchAll(/\bnew\s+Bun\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) noteCall(m[1]!, file, true);
  };
  for (const f of new Bun.Glob("*.md").scanSync({ cwd: join(ROOT, "docs"), onlyFiles: true })) {
    scan(readFileSync(join(ROOT, "docs", f), "utf8"), f);
  }
  for (const f of new Bun.Glob("*page.ts").scanSync({ cwd: join(ROOT, "src/research"), onlyFiles: true })) {
    scan(readFileSync(join(ROOT, "src/research", f), "utf8"), f);
  }
  return { out, callSites };
}

/** Load the per-version probe cache. */
function loadCache(): Record<string, Record<string, string>> {
  const p = join(ROOT, ".data", "api-cache.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, Record<string, string>>; }
  catch { return {}; }
}

/** True when the token is allowlisted (any bucket). */
function allowed(tok: string): boolean {
  return INTENTIONAL.has(tok) || TYPE_ONLY.has(tok) || PROSE.has(tok) || WILDCARD_FAMILIES.has(tok);
}

async function main() {
  console.log("docs:api — bun " + Bun.version + " (" + Bun.revision.slice(0, 8) + ")" + (STRICT ? " STRICT=1" : ""));
  const { out: tokens, callSites } = collectTokens();
  const all = [...tokens.keys()];
  const cache = loadCache();
  const version = Bun.version;
  const cached = cache[version] ?? {};
  const toProbe = all.filter((t) => !(t in cached));
  const results: Record<string, string> = {};
  for (const t of toProbe) {
    try { results[t] = typeof (Bun as any)[t] !== "undefined" ? "exists" : "MISSING"; }
    catch (e) { results[t] = "THREW:" + String(e).slice(0, 40); }
  }
  cache[version] = { ...cached, ...results };
  await Bun.write(join(ROOT, ".data", "api-cache.json"), JSON.stringify(cache, null, 2) + "\n");
  const probed = cache[version]!;

  // classify existence
  let fails = 0;
  const rows: Array<{ tok: string; status: string; files: string }> = [];
  for (const [tok, meta] of tokens) {
    const status = probed[tok] ?? "not-probed";
    if (status === "exists") continue; // fine
    if (INTENTIONAL.has(tok) || TYPE_ONLY.has(tok) || PROSE.has(tok)) {
      rows.push({ tok, status: "ok (allowed: " + (INTENTIONAL.has(tok) ? "intentional" : TYPE_ONLY.has(tok) ? "type-only" : "prose") + ")", files: meta.files.join(",") });
      continue;
    }
    if (WILDCARD_FAMILIES.has(tok)) {
      const members = Object.keys(Bun).filter((k) => k.startsWith(tok) && typeof (Bun as any)[k] !== "undefined");
      rows.push({ tok: tok + "*", status: members.length ? "ok (family: " + members.length + " members)" : "MISSING (no members)", files: meta.files.join(",") });
      if (!members.length) fails++;
      continue;
    }
    rows.push({ tok, status: "MISSING (unallowed)", files: meta.files.join(",") });
    fails++;
  }

  // STRICT: callability on MISSING tokens
  const strictRows: Array<{ tok: string; detail: string }> = [];
  if (STRICT) {
    for (const [tok, c] of callSites) {
      if (probed[tok] === "exists") continue;
      if (allowed(tok)) continue; // intentional/type/prose/wildcard — documented, not a bug
      if (c.call > 0) strictRows.push({ tok, detail: "call-site x" + c.call + " on MISSING token (" + c.files.join(",") + ")" });
      if (c.news > 0) strictRows.push({ tok, detail: "new-site x" + c.news + " on MISSING token (" + c.files.join(",") + ")" });
    }
  }

  // report
  rows.sort((a, b) => a.tok.localeCompare(b.tok));
  for (const r of rows) console.log((r.status.startsWith("MISSING") ? "FAIL " : "ok   ") + r.tok.padEnd(22) + r.status.padEnd(32) + r.files.slice(0, 60));
  if (STRICT) {
    for (const s of strictRows) { console.log("FAIL " + s.tok.padEnd(22) + s.detail); fails++; }
  }
  console.log("---");
  console.log("docs:api — " + all.length + " tokens · " + rows.length + " non-exists classified · " + fails + " genuine drift" + (STRICT ? " (STRICT incl. callability)" : "") + (fails ? " (fix docs or allowlist)" : ""));
  await writeDocsGateState("api-state.json", { ok: fails === 0, fails, tokens: all.length, strict: STRICT ? 1 : 0 });

  // .data/api-report.md
  const mdLines: string[] = [
    "# docs:api report — Bun " + Bun.version + " (" + Bun.revision.slice(0, 8) + ")",
    "",
    "Generated by `bun run docs:api" + (STRICT ? "` (STRICT=1)" : "`") + " — " + new Date().toISOString(),
    "",
    "## Existence classification (" + all.length + " tokens)",
    "",
    "| token | status | files |",
    "|---|---|---|",
  ];
  for (const r of [...rows].sort((a, b) => a.tok.localeCompare(b.tok))) {
    mdLines.push("| `" + r.tok + "` | " + r.status.replace(/\|/g, "\\|") + " | " + r.files + " |");
  }
  if (STRICT) {
    mdLines.push("", "## STRICT callability findings", "");
    if (!strictRows.length) mdLines.push("_none — every call-site/new-site is on an existing or allowlisted token_");
    else { mdLines.push("| token | finding |", "|---|---|"); for (const s of strictRows) mdLines.push("| `" + s.tok + "` | " + s.detail.replace(/\|/g, "\\|") + " |"); }
  }
  mdLines.push("", "## Note: param-count validation rejected", "");
  mdLines.push("13/41 call tokens are overloaded in bun-types (file=7, hash=9, write=5) and docs abbreviate args — regex param matching is a false-positive machine (§62). STRICT stops at callability, which is noise-free.");
  await Bun.write(join(ROOT, ".data", "api-report.md"), mdLines.join("\n") + "\n");
  process.exit(fails === 0 ? 0 : 1);
}

await main();