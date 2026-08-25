#!/usr/bin/env bun
/**
 * `bun run bun:apis-probe` — probe the v1.4 API-surface claims from the
 * pasted API table (§115) that were NOT already covered: Bun.semver and
 * Bun.JSON5 (new), plus re-confirmations of two CORRECTED rows (Bun.sha
 * is SHA-512/256 per §24, not SHA-256; Temporal IS shipped per §88, the
 * table's 'not yet natively shipped' is false).
 *
 * VERIFIED on Bun 1.4.0 (34cbb9a40):
 *  P1 Bun.semver is a GLOBAL { satisfies, order } (importing 'bun:semver'
 *     FAILS — the API is on the Bun global, not a module)
 *  P2 Bun.JSON5 is a GLOBAL: parse handles comments/trailing commas/
 *     unquoted keys; stringify emits compact unquoted-key JSON5
 *  P3 Bun.sha EXISTS and is SHA-512/256 (hex of 'abc' matches the
 *     sha512-256 vector; default returns a Uint8Array) — the table's
 *     'SHA-256' label is wrong; the repo corrected this in §24
 *  P4 Temporal IS enabled by default (typeof object, Instant works) —
 *     the table's 'not yet natively shipped' is FALSE (§88)
 */

export {}; // top-level await requires module context (tsc)

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1: Bun.semver global.
const sem = Bun.semver as { satisfies?: (v: string, r: string) => boolean; order?: (a: string, b: string) => number };
check("P1 Bun.semver global (satisfies + order)", typeof sem.satisfies === "function" && typeof sem.order === "function" && sem.satisfies("1.2.3", "^1.0.0") === true && (sem.order("2.0.0", "1.9.0") ?? 0) > 0, "global, not a module");

// P2: Bun.JSON5 global.
const j5 = Bun.JSON5.parse("{ a: 1, /* c */ b: 2, }") as { a: number; b: number };
const j5s = Bun.JSON5.stringify({ a: 1, b: 2 });
check("P2 Bun.JSON5 parse (comments/trailing/unquoted) + stringify", j5.a === 1 && j5.b === 2 && typeof j5s === "string" && j5s.includes("a:1"), j5s);

// P3: Bun.sha is SHA-512/256.
const shaHex = Bun.sha("abc", "hex") as string;
const VECTOR = "53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23";
const shaRaw = Bun.sha("abc");
check("P3 Bun.sha is SHA-512/256 (not SHA-256)", typeof shaHex === "string" && shaHex === VECTOR && shaRaw instanceof Uint8Array, "matches the sha512-256 vector; §24");

// P4: Temporal enabled by default.
check("P4 Temporal shipped (table claim false)", typeof Temporal === "object" && typeof (Temporal as { Instant?: unknown }).Instant === "function", "enabled by default; §88");

// P5-P7: node:quic + serve http3 (§120).
const quic = await import("node:quic");
const quicKeys = Object.keys(quic);
check("P5 node:quic module exists (lsquic-backed QUIC)", ["connect", "listen", "QuicSession", "QuicStream"].every((k) => quicKeys.includes(k)), "ExperimentalWarning emitted; Bun.Quic global is undefined");
let h3Err = "";
try { const s3 = Bun.serve({ port: 0, fetch() { return new Response("q"); }, http3: true } as any); s3.stop(true); h3Err = "accepted-without-tls"; } catch (e: any) { h3Err = String(e.message).slice(0, 60); }
check("P6 serve http3 option recognized (requires tls)", h3Err.includes("HTTP/3 requires"), h3Err);
check("P7 Bun.Quic global absent (QUIC is node:quic only)", typeof (Bun as Record<string, unknown>).Quic === "undefined");

// P8: node:quic listen() is NOT functional on this runtime (pinned).
// A working listen would exit 0 and print after-listen-call; the current
// build ABORTS at internal:quic (exit 1). If a Bun upgrade fixes listen,
// this check fails -> gate flags -> re-probe + update the pin.
const qdir = mkdtempSync(join(tmpdir(), "quic-pin-"));
const qfile = join(qdir, "listen.ts");
writeFileSync(qfile, "import { listen } from \"node:quic\";\nlisten(() => {});\nconsole.log(\"after-listen-call\");\n");
const qproc = Bun.spawnSync(["bun", qfile], { stdout: "pipe", stderr: "pipe", timeout: 5000 });
const listenCrashed = qproc.exitCode === 1; // async abort at internal:quic — a working listen would exit 0 or keep the process alive
rmSync(qdir, { recursive: true, force: true });
check("P8 node:quic listen() non-functional (async abort pinned)", listenCrashed, "exit " + qproc.exitCode + " — blog full-API claim overstated (§121)");

const failed = results.filter((r) => !r.pass);
console.log("bun:apis-probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
