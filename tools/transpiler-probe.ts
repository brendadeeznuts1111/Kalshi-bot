#!/usr/bin/env bun
/**
 * `bun run transpiler:probe` — Bun.Transpiler internals (§142): the
 * scan APIs the repo enforcement relies on (guard scanImports,
 * docs-validate .scan), loaders, define, macros, target, minify.
 * Bun 1.4.0.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// P1 loaders: ts strips types, tsx handles JSX.
const tTs = new Bun.Transpiler({ loader: "ts" });
const tsOut = tTs.transformSync("const x: number = 1;");
check("P1 ts loader strips types", tsOut.includes("const x = 1") && !tsOut.includes(": number"), tsOut.trim());
const tTsx = new Bun.Transpiler({ loader: "tsx" });
check("P1a tsx JSX", typeof tTsx.transformSync("const el = <div/>;") === "string", "");

// P2 define: replaces process.env refs + plain identifiers; others kept.
const tDef = new Bun.Transpiler({ loader: "ts", define: { "process.env.API_URL": "\"https://x\"", "DEV": "true" } });
const defOut = tDef.transformSync("const u = process.env.API_URL;\nconst v = process.env.OTHER;\nconst w = DEV;");
check("P2 define replaces", defOut.includes("\"https://x\"") && defOut.includes("process.env.OTHER") && defOut.includes("true"), defOut.trim());

// P3 scan(): { imports, exports } — the guard/docs-validate surface.
const src = 'import a from "x";\nimport "side-effect";\nconst d = await import("dyn");\nexport const e = 1;\nconst r = require("req-mod");';
const scan = new Bun.Transpiler().scan(src);
const kinds = (scan.imports as any[]).map((i) => i.kind + ":" + i.path).sort();
check("P3 scan imports+exports", Array.isArray(scan.imports) && Array.isArray(scan.exports) && scan.exports.includes("e") && kinds.join("|") === "dynamic-import:dyn|import-statement:side-effect|import-statement:x|require-call:req-mod", JSON.stringify(kinds));

// P4 scanImports() parity (the guard uses scanImports).
const si = new Bun.Transpiler().scanImports(src);
check("P4 scanImports parity", JSON.stringify(si) === JSON.stringify(scan.imports), JSON.stringify((si as any[]).map((i) => i.kind)));

// P5 macro imports THROW at transform when the file is unresolvable
// (pinned — transpiler is not a macro runner; builds resolve macros).
let macroErr = "no-throw";
try { new Bun.Transpiler({ loader: "ts" }).transformSync('import { f } from "./definitely-missing-macro.ts" with { type: "macro" };\nconsole.log(f(1));'); } catch (e) { macroErr = "throws"; }
check("P5 macro import throws when unresolvable", macroErr === "throws", macroErr + " (AggregateError/Parse error or Macro-not-found — variant by loader)");

// P6 target bun vs node: identical for plain ESM (no CJS preamble).
const code = 'import fs from "node:fs";\nconsole.log(fs);';
const tb = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(code);
const tn = new Bun.Transpiler({ loader: "ts", target: "node" }).transformSync(code);
check("P6 target bun === node for ESM", tb === tn && tb.includes("node:fs"), "bun==node:" + (tb === tn));

// P7 invalid syntax throws.
let synErr = "no-throw";
try { new Bun.Transpiler({ loader: "ts" }).transformSync("const = ;"); } catch { synErr = "throws"; }
check("P7 invalid syntax throws", synErr === "throws", synErr);

// P8 minify: whitespace-only vs full (renames).
const mWs = new Bun.Transpiler({ loader: "js", minify: { whitespace: true } } as any).transformSync("const x = 1; function f() { return x; } f();");
const mFull = new Bun.Transpiler({ loader: "js", minify: true } as any).transformSync("const x = 1; function f() { return x; } f();");
check("P8 minify whitespace vs full", mWs.includes("function f()") && !mFull.includes("function f"), "ws=" + mWs.trim() + " | full=" + mFull.trim());

const failed = results.filter((r) => !r.pass);
console.log("transpiler:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
