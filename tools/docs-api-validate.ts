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
 * Exit 1 only for UNALLOWED missing tokens (genuine drift).
 *
 * @see docs/AGENT-PITFALLS.md §62
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TOKEN_RE = /\bBun\.([A-Za-z_$][A-Za-z0-9_$]*)\b/g;

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
  "zstd", // §62: no Bun.zstd — real APIs are zstdCompressSync/zstdDecompressSync
  "image", // §12: lowercase form documented as non-existent (the API is Bun.Image capital); prose in §12 body
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

/** Scan markdown + widget pages for Bun.<token> mentions. */
function collectTokens(): Map<string, { count: number; files: string[] }> {
  const out = new Map<string, { count: number; files: string[] }>();
  const add = (tok: string, file: string) => {
    const e = out.get(tok);
    if (e) { e.count++; if (!e.files.includes(file)) e.files.push(file); }
    else out.set(tok, { count: 1, files: [file] });
  };
  for (const f of new Bun.Glob("*.md").scanSync({ cwd: join(ROOT, "docs"), onlyFiles: true })) {
    const text = readFileSync(join(ROOT, "docs", f), "utf8");
    for (const m of text.matchAll(TOKEN_RE)) add(m[1]!, f);
  }
  for (const f of new Bun.Glob("*page.ts").scanSync({ cwd: join(ROOT, "src/research"), onlyFiles: true })) {
    const text = readFileSync(join(ROOT, "src/research", f), "utf8");
    for (const m of text.matchAll(TOKEN_RE)) add(m[1]!, f);
  }
  return out;
}

/** Load the per-version probe cache. */
function loadCache(): Record<string, Record<string, string>> {
  const p = join(ROOT, ".data", "api-cache.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as Record<string, Record<string, string>>; }
  catch { return {}; }
}

async function main() {
  console.log("docs:api — bun " + Bun.version + " (" + Bun.revision.slice(0, 8) + ")");
  const tokens = collectTokens();
  const all = [...tokens.keys()];
  const cache = loadCache();
  const version = Bun.version;
  const cached = cache[version] ?? {};
  const toProbe = all.filter((t) => !(t in cached));
  const results: Record<string, string> = {};
  // probe missing-from-cache tokens in ONE process (typeof, no spawn)
  for (const t of toProbe) {
    try { results[t] = typeof (Bun as any)[t] !== "undefined" ? "exists" : "MISSING"; }
    catch (e) { results[t] = "THREW:" + String(e).slice(0, 40); }
  }
  cache[version] = { ...cached, ...results };
  await Bun.write(join(ROOT, ".data", "api-cache.json"), JSON.stringify(cache, null, 2) + "\n");
  const probed = cache[version]!;

  // classify
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
      // verify the family actually exists as real members
      const members = Object.keys(Bun).filter((k) => k.startsWith(tok) && typeof (Bun as any)[k] !== "undefined");
      rows.push({ tok: tok + "*", status: members.length ? "ok (family: " + members.length + " members)" : "MISSING (no members)", files: meta.files.join(",") });
      if (!members.length) fails++;
      continue;
    }
    rows.push({ tok, status: "MISSING (unallowed)", files: meta.files.join(",") });
    fails++;
  }
  rows.sort((a, b) => a.tok.localeCompare(b.tok));
  for (const r of rows) console.log((r.status.startsWith("MISSING") ? "FAIL " : "ok   ") + r.tok.padEnd(22) + r.status.padEnd(32) + r.files.slice(0, 60));
  console.log("---");
  console.log("docs:api — " + all.length + " tokens · " + rows.length + " non-exists classified · " + fails + " genuine drift" + (fails ? " (fix docs or allowlist)" : ""));
  process.exit(fails === 0 ? 0 : 1);
}

await main();