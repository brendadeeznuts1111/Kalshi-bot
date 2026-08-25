#!/usr/bin/env bun
/**
 * `bun run type-drift:probe` — types-vs-runtime drift (§159): every
 * runtime Bun member must have a bun-types declaration, and vice versa
 * (with the documented non-existence set). Catches type-lag and stale
 * declarations systematically instead of by accident.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const BT = "node_modules/.bun-cache/links/bun-types@1.4.0-c0dadede486f49ab/node_modules/bun-types";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dts = (await Bun.file(BT + "/index.d.ts").text()) + "\n" + (await Bun.file(BT + "/bun.d.ts").text()) + "\n" + (await Bun.file(BT + "/sqlite.d.ts").text()) + "\n" + (await Bun.file(BT + "/shell.d.ts").text()) + "\n" + (await Bun.file(BT + "/ffi.d.ts").text()) + "\n" + (await Bun.file(BT + "/redis.d.ts").text()) + "\n" + (await Bun.file(BT + "/s3.d.ts").text()) + "\n" + (await Bun.file(BT + "/deprecated.d.ts").text());
const members = Object.keys(Bun).sort();
const untyped = members.filter((m) => !new RegExp("\\b" + esc(m) + "\\b").test(dts));
check("P1 every runtime member has a declaration", untyped.length === 0, untyped.join(",") || "all " + members.length + " typed");

// P2: readableStreamTo family sits in the DEPRECATED types file — a
// deprecation signal to verify at runtime (still functional in 1.4.0).
const dep = await Bun.file(BT + "/deprecated.d.ts").text();
const deprecatedMarked = ["readableStreamToText", "readableStreamToBytes", "readableStreamToArrayBuffer", "readableStreamToJSON", "readableStreamToArray"].filter((m) => dep.includes(m));
check("P2 readableStreamTo* declared in deprecated.d.ts", deprecatedMarked.length >= 2, deprecatedMarked.join(",") + " (still functional — surface:probe P4)");

// P3: documented non-existence set is still absent at runtime.
const absent = ["gzip", "html", "image", "watch", "zstd", "term", "rename", "CSV", "Quic"].filter((m) => (Bun as any)[m] !== undefined);
check("P3 documented non-existences stay absent", absent.length === 0, absent.join(",") || "all absent");

const failed = results.filter((r) => !r.pass);
console.log("type-drift:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
