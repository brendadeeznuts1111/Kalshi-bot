#!/usr/bin/env bun
/**
 * `bun run coverage:matrix` — regenerate docs/BUN_API_COVERAGE.md from
 * the repo alone (self-contained; promoted from scratch/matrix-gen3.ts,
 * §163). Scans src/tools/scripts/tests for Bun.* tokens, sweeps the
 * runtime typeofs, checks bun-types declarations + docs mentions, and
 * applies the gate-coverage map. Offline.
 */
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BT = join(ROOT, "node_modules/.bun-cache/links/bun-types@1.4.0-c0dadede486f49ab/node_modules/bun-types");

const GATES: Record<string, string> = {
  file: "fs:probe", write: "fs:probe", mmap: "fs:probe", stdout: "fs:probe",
  gzipSync: "fs:probe", gunzipSync: "fs:probe", deflateSync: "fs:probe", inflateSync: "fs:probe",
  zstdCompressSync: "fs:probe", zstdDecompressSync: "fs:probe", zstdCompress: "fs:probe", zstdDecompress: "fs:probe", Archive: "fs:probe",
  "$": "shell:probe", semver: "bun:apis-probe", JSON5: "bun:apis-probe", sha: "bun:apis-probe",
  spawn: "spawn:probe", spawnSync: "spawn:probe", build: "build-deep:probe", plugin: "build-deep:probe",
  serve: "serve-tls/routes", fetch: "serve-tls/routes", sql: "sqlite:probe", SQL: "sqlite:probe",
  cron: "cron tests §126/128",
  color: "ansi:probe", inspect: "ansi:probe", escapeHTML: "ansi:probe", stringWidth: "ansi:probe", stripANSI: "ansi:probe", sliceAnsi: "ansi:probe", wrapAnsi: "ansi:probe",
  CryptoHasher: "crypto:probe", SHA256: "crypto:probe", hash: "crypto:probe", deepEquals: "crypto:probe", randomUUIDv7: "crypto:probe",
  Image: "image:probe", markdown: "format:probe", XML: "format:probe", TOML: "format:probe", JSONL: "format:probe", YAML: "format:probe", JSONC: "format:probe",
  Glob: "fsx:probe", which: "fsx:probe", resolve: "fsx:probe", fileURLToPath: "fsx:probe", pathToFileURL: "fsx:probe", openInEditor: "fsx:probe",
  connect: "security:probe", CSRF: "csrf:probe", Cookie: "defaults:probe", CookieMap: "defaults:probe",
  listen: "net:probe", udpSocket: "net:probe", dns: "net:probe", redis: "net:probe", secrets: "net:probe",
  env: "runtime:probe", argv: "runtime:probe", sleep: "runtime:probe", version: "runtime:probe", revision: "runtime:probe", nanoseconds: "runtime:probe",
  peek: "runtime:probe", readableStreamToArrayBuffer: "runtime:probe", readableStreamToText: "runtime:probe", ArrayBufferSink: "runtime:probe", Transpiler: "runtime:probe", Terminal: "runtime:probe", WebView: "runtime:probe",
  MD4: "surface:probe", MD5: "surface:probe", SHA1: "surface:probe", SHA224: "surface:probe", SHA384: "surface:probe", SHA512: "surface:probe", SHA512_256: "surface:probe",
  password: "surface:probe", FileSystemRouter: "surface:probe", deepMatch: "surface:probe", concatArrayBuffers: "surface:probe",
  gc: "surface:probe", shrink: "surface:probe", generateHeapSnapshot: "surface:probe", isMainThread: "surface:probe", isStandaloneExecutable: "surface:probe", main: "surface:probe", unsafe: "surface:probe",
  indexOfLine: "surface:probe", resolveSync: "surface:probe", allocUnsafe: "surface:probe", embeddedFiles: "surface:probe", stderr: "surface:probe", stdin: "surface:probe",
  postgres: "client-shape:probe", RedisClient: "client-shape:probe", s3: "client-shape:probe", S3Client: "client-shape:probe",
  randomUUIDv5: "surface:probe", readableStreamToArray: "surface:probe", readableStreamToBlob: "surface:probe", readableStreamToBytes: "surface:probe", readableStreamToJSON: "surface:probe",
  enableANSIColors: "ecosystem:probe", FFI: "ffi:probe",
};

// 1) repo token counts (single rg over the source dirs).
const scan = Bun.spawnSync(["rg", "-o", "Bun\.[A-Za-z_$][A-Za-z0-9_$]*", "src", "tools", "scripts", "tests", "--no-filename"], { cwd: ROOT, stdout: "pipe" });
const counts: Record<string, number> = {};
for (const l of (scan.stdout?.toString() ?? "").split("\n")) {
  const m = l.match(/Bun\.([A-Za-z_$][A-Za-z0-9_$]*)/);
  if (m) counts[m[1]!] = (counts[m[1]!] ?? 0) + 1;
}
// no $ hardcode: rg counts Bun.$ correctly (verified 47)

// 2) runtime typeof sweep + 3) d.ts presence + 4) docs presence.
const dtsFiles = ["index.d.ts", "bun.d.ts", "sqlite.d.ts", "shell.d.ts", "ffi.d.ts", "redis.d.ts", "s3.d.ts", "deprecated.d.ts"];
let dts = "";
for (const f of dtsFiles) { try { dts += await Bun.file(join(BT, f)).text(); } catch { /* missing */ } }

const tokens = new Set([...Object.keys(counts), ...Object.keys(GATES)]);
const rows: { t: string; r: string; ty: boolean; doc: boolean; gate: string; c: number }[] = [];
for (const t of tokens) {
  const v: any = (Bun as any)[t];
  const isType = v === undefined;
  const docHit = Bun.spawnSync(["rg", "-l", t, join(BT, "docs"), "-g", "*.mdx", "--no-messages"], { stdout: "pipe" }).stdout?.toString().length ?? 0;
  rows.push({ t, r: isType ? "type-only" : typeof v, ty: dts.includes(t), doc: docHit > 0, gate: GATES[t] ?? (isType ? "type-only" : "GAP"), c: counts[t] ?? 0 });
}
rows.sort((a, b) => (a.r === "type-only" ? 1 : 0) - (b.r === "type-only" ? 1 : 0) || b.c - a.c);

const md = [
  "# Bun API Coverage Matrix",
  "",
  "Regenerated by `bun run coverage:matrix` (tools/bun-coverage-matrix.ts, §163).",
  "Runtime/types/docs columns against the pinned Bun 1.4.0. GAP = unprobed;",
  "type-only/non-existent = documented in tools/docs-api-validate.ts.",
  "",
  "| Token | Runtime | Types | Docs | Gate | Uses |",
  "|---|---|---|---|---|---|",
  ...rows.map((x) => "| `" + x.t + "` | " + x.r + " | " + (x.ty ? "y" : "n") + " | " + (x.doc ? "y" : "n") + " | " + x.gate + " | " + x.c + " |"),
  "",
].join("\n");
await Bun.write(join(ROOT, "docs/BUN_API_COVERAGE.md"), md);
const gaps = rows.filter((x) => x.gate === "GAP" && x.r !== "type-only");
console.log("matrix regenerated:", rows.length, "rows ·", gaps.length, "GAPs:", gaps.map((g) => g.t).join(",") || "none");
process.exit(gaps.length === 0 ? 0 : 1);

export {};
