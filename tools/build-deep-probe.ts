#!/usr/bin/env bun
/**
 * `bun run build-deep:probe` — bundler internals: splitting, macros,
 * env inlining, plugins (§130). Verified against Bun 1.4.0 (34cbb9a40)
 * and installed bun-types docs (bundler/macros, bundler/index splitting,
 * bundler/plugins). Self-contained: fixtures generated at runtime.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const D = "scratch/build-deep";
await Bun.write(D + "/shared.ts", 'export const SHARED = "shared-code-marker";\n');
await Bun.write(D + "/entry-a.ts", 'import { SHARED } from "./shared.ts";\nconsole.log("A", SHARED);\n');
await Bun.write(D + "/entry-b.ts", 'import { SHARED } from "./shared.ts";\nconsole.log("B", SHARED);\n');

// P1: splitting:true -> shared module split into a single chunk.
const r1 = await Bun.build({ entrypoints: [D + "/entry-a.ts", D + "/entry-b.ts"], splitting: true, outdir: D + "/out-split" });
if (r1.success) {
  const paths = r1.outputs.map((o: any) => o.path.replace(process.cwd() + "/", ""));
  check("P1 splitting shared chunk", r1.outputs.length >= 3 && paths.some((p) => p.includes("chunk-")), JSON.stringify(paths));
  const chunk = r1.outputs.find((o: any) => o.path.includes("chunk-"));
  const chunkText = chunk ? await chunk.text() : "";
  check("P1a shared code once", chunkText.includes("shared-code-marker") && (chunkText.split("shared-code-marker").length - 1) === 1, "count=" + (chunkText.split("shared-code-marker").length - 1));
} else { check("P1 splitting shared chunk", false, JSON.stringify(r1.logs)); }

// P1b: without splitting the shared code is duplicated per entry.
const r1b = await Bun.build({ entrypoints: [D + "/entry-a.ts", D + "/entry-b.ts"], outdir: D + "/out-nosplit" });
if (r1b.success) {
  const texts = await Promise.all(r1b.outputs.map((o: any) => o.text()));
  const total = texts.join("").split("shared-code-marker").length - 1;
  check("P1b no-splitting duplicates", r1b.outputs.length === 2 && total === 2, "count=" + total);
} else { check("P1b no-splitting duplicates", false, JSON.stringify(r1b.logs)); }

// P2: macro FUNCTION call inlined; source absent from bundle.
await Bun.write(D + "/macro.ts", 'export function magic(x: number) { return "MAGIC_" + x + "_" + Math.floor(Math.random() * 1e6); }\nexport const TABLE = { a: 1, b: 2 };\n');
await Bun.write(D + "/cli.ts", 'import { magic, TABLE } from "./macro.ts" with { type: "macro" };\nconst r = magic(7);\nconsole.log(r, TABLE.b);\n');
const r2 = await Bun.build({ entrypoints: [D + "/cli.ts"], outdir: D + "/out-macro" });
if (r2.success) {
  const text = await r2.outputs[0].text();
  const m = text.match(/MAGIC_7_(\d+)/);
  check("P2 macro call inlined", !!m && !text.includes("Math.random") && !text.includes("magic("), "res=" + (m ? m[1] : "none"));
  // P2b CORRECTION: macro CONST exports are NOT inlined — the reference
  // survives into the bundle with no definition (ReferenceError at run).
  check("P2b macro const NOT inlined (dangling ref)", text.includes("TABLE.b") && !text.includes("const TABLE") && !text.includes("var TABLE"), text.slice(0, 80));
} else { check("P2 macro call inlined", false, JSON.stringify(r2.logs)); }

// P2c: the assert { type: "macro" } form works like the with form.
await Bun.write(D + "/cli-assert.ts", 'import { magic } from "./macro.ts" assert { type: "macro" };\nconsole.log("ASSERT", magic(3));\n');
const r2c = await Bun.build({ entrypoints: [D + "/cli-assert.ts"], outdir: D + "/out-macro-assert" });
if (r2c.success) {
  const text = await r2c.outputs[0].text();
  check("P2c assert form works", /MAGIC_3_(\d+)/.test(text), "");
} else { check("P2c assert form works", false, JSON.stringify(r2c.logs)); }

// P3 CORRECTION: env inlining (env: "PUBLIC_*") reads the process
// STARTUP environment — process.env mutations made at runtime are NOT
// seen (verified: CLI --env=PUBLIC_* and startup env DO inline; the
// in-process assignment is ignored). Pinned so a fix flips the gate.
process.env.PUBLIC_API_URL = "inprocess.example.com";
await Bun.write(D + "/env.ts", 'const url = process.env.PUBLIC_API_URL;\nconst secret = process.env.SECRET_TOKEN;\nconsole.log(url, secret);\n');
const r3 = await Bun.build({ entrypoints: [D + "/env.ts"], outdir: D + "/out-env", env: "PUBLIC_*" as any });
if (r3.success) {
  const text = await r3.outputs[0].text();
  check("P3 env inlining ignores in-process env", !text.includes("inprocess.example.com") && text.includes("process.env.PUBLIC_API_URL"), text.slice(0, 80));
  check("P3a non-prefixed preserved", text.includes("process.env.SECRET_TOKEN"), "");
} else { check("P3 env inlining ignores in-process env", false, JSON.stringify(r3.logs)); }

// P4: plugin virtual module via onResolve + onLoad; lifecycle hooks fire.
await Bun.write(D + "/plug.ts", 'import { V } from "virt:data";\nconsole.log("PLUG", V);\n');
let started = 0;
let ended = 0;
const r4 = await Bun.build({
  entrypoints: [D + "/plug.ts"],
  outdir: D + "/out-plug",
  plugins: [{
    name: "virt-plugin",
    setup(build: any) {
      build.onStart(() => { started++; });
      build.onEnd(() => { ended++; });
      build.onResolve({ filter: /^virt:/ }, (args: any) => ({ path: "virt:data", namespace: "virt" }));
      build.onLoad({ filter: /.*/, namespace: "virt" }, () => ({ loader: "js", contents: "export const V = 42;" }));
    },
  }],
});
if (r4.success) {
  const text = await r4.outputs[0].text();
  check("P4 virtual module plugin", text.includes("PLUG") && text.includes("42") && !text.includes("export const V = 42"), "");
  check("P4a onStart/onEnd fired", started === 1 && ended === 1, "start=" + started + " end=" + ended);
} else { check("P4 virtual module plugin", false, JSON.stringify(r4.logs)); }

const failed = results.filter((r) => !r.pass);
console.log("build-deep:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
