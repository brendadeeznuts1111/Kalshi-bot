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

const failed = results.filter((r) => !r.pass);
console.log("bun:apis-probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
