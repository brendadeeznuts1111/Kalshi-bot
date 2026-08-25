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


// ── §143: doc-grounded surface (runtime/transpiler.mdx) ──

// P9 per-call loader override (doc: transformSync(code, loader)).
const tJs = new Bun.Transpiler({ loader: "js" });
check("P9 per-call loader override", tJs.transformSync("const el = <div/>;", "tsx").includes("jsxDEV"), tJs.transformSync("const el = <div/>;", "tsx").trim().slice(0, 40));

// P10 async transform() (doc: Promise<string>).
const tAsync = await new Bun.Transpiler({ loader: "ts" }).transform("const x: number = 1;");
check("P10 async transform()", typeof tAsync === "string" && tAsync.includes("const x = 1"), tAsync.trim());

// P11 doc example: type-only imports/exports IGNORED by scan(); the docs
// show require-call ABSENT from scan() output (scanImports includes it).
const docCode = 'import React from "react";\nimport type { ReactNode } from "react";\nconst val = require("./cjs.js");\nimport("./loader");\nexport const name = "hello";';
const docScan = new Bun.Transpiler({ loader: "tsx" }).scan(docCode);
const docKinds = (docScan.imports as any[]).map((i) => i.kind).join(",");
check("P11 scan() doc example (type-only ignored, require-call omitted)", docKinds === "import-statement,dynamic-import" && JSON.stringify(docScan.exports) === JSON.stringify(["name"]), docKinds);

// P12 scanImports() includes require-call (consistent — the doc's
// scanImports example lists it).
const docSI = new Bun.Transpiler({ loader: "tsx" }).scanImports(docCode);
check("P12 scanImports includes require-call", (docSI as any[]).some((i) => i.kind === "require-call" && i.path === "./cjs.js"), JSON.stringify((docSI as any[]).map((i) => i.kind)));

// P13 CORRECTION: CSS import scanning unsupported on 1.4.0 (the docs
// list import-rule/url-token kinds, but the css loader is rejected).
let cssErr = "no-throw";
try { new Bun.Transpiler({ loader: "css" } as any).scan("@import \"foo.css\";"); } catch (e) { cssErr = String((e as Error).message).includes("JavaScript-like") ? "css-rejected" : "throws"; }
check("P13 CSS loader rejected (pinned)", cssErr === "css-rejected", cssErr);

// P14 CORRECTION: tsconfig jsxFactory/jsxRuntime ignored — jsxDEV (the
// automatic runtime) is emitted regardless (docs claim Preact via tsconfig).
const tPreact = new Bun.Transpiler({ loader: "tsx", tsconfig: JSON.stringify({ jsxFactory: "h", jsxFragment: "Fragment", jsxRuntime: "classic" }) } as any);
check("P14 tsconfig jsxFactory ignored (jsxDEV emitted)", tPreact.transformSync("const el = <div/>;").includes("jsxDEV"), tPreact.transformSync("const el = <div/>;").trim().slice(0, 30));

// P15 exports eliminate/replace (doc: TranspilerOptions.exports).
const tElim = new Bun.Transpiler({ loader: "ts", exports: { eliminate: ["unused"], replace: { keep: "renamed" } } } as any);
const elimOut = tElim.transformSync("export const unused = 1;\nexport const keep = 2;");
check("P15 exports eliminate + replace", !elimOut.includes("unused") && elimOut.includes("renamed"), elimOut.trim());

// P16 minifyWhitespace (doc name) + inline constants (doc: inline).
const tWs = new Bun.Transpiler({ loader: "js", minifyWhitespace: true } as any);
const tInline = new Bun.Transpiler({ loader: "js", inline: true } as any);
const inlineOut = tInline.transformSync("const A = 42;\nconsole.log(A);");
check("P16 minifyWhitespace + inline", tWs.transformSync("const x = 1;   function f() { return x; }   f();").trim() === "const x=1;function f(){return x}f();" && inlineOut.includes("console.log(42)"), "ws + inline:" + (inlineOut.includes("console.log(42)")));

const failed = results.filter((r) => !r.pass);
console.log("transpiler:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
