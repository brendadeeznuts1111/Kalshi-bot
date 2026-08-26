#!/usr/bin/env bun
/**
 * `bun run metafile:probe` — the Bun.build metafile schema (§155) that
 * the mtafile/design:build pipeline (dist/*.meta.json + --metafile-md)
 * produces. Verified against the pasted esbuild-compatible schema.
 * Bun 1.4.0, offline fixtures.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const F = "scratch/meta-fixture";
await Bun.write(F + "/shared.ts", 'export const SHARED = "s";\n');
await Bun.write(F + "/dyn.ts", 'export const D = "d";\n');
await Bun.write(F + "/dead.ts", 'export const X = "x";\n');
await Bun.write(F + "/style.css", "body { color: red; }\n");
await Bun.write(F + "/entry.ts", 'import { SHARED } from "./shared.ts";\nimport "./style.css";\nif (false) { await import("./dead.ts"); }\nexport const main = () => SHARED;\n');
await Bun.write(F + "/ext.ts", 'import { join } from "node:path";\nimport * as ts from "typescript";\nexport const p = join("a", "b");\nexport const v = ts.version;\n');

const res = await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/meta-out", metafile: true });
const mf: any = res.metafile;
check("P1 top-level inputs + outputs", "inputs" in mf && "outputs" in mf, Object.keys(mf).join(","));
const input = Object.values(mf.inputs)[0] as any;
check("P2 input keys bytes/imports/format", typeof input.bytes === "number" && Array.isArray(input.imports) && typeof input.format === "string", Object.keys(input).join(","));
const relImp = Object.values(mf.inputs).flatMap((i: any) => i.imports).find((i: any) => i.path?.includes("shared.ts"));
check("P3 relative import shape {path,kind,original}", relImp && relImp.kind === "import-statement" && relImp.original === "./shared.ts" && !("external" in relImp), JSON.stringify(relImp));

const resExt = await Bun.build({ entrypoints: [F + "/ext.ts"], outdir: "scratch/meta-out3", metafile: true });
const extImps = Object.values(resExt.metafile!.inputs).flatMap((i: any) => i.imports);
check("P4 external flag on node_modules requires", extImps.some((i: any) => i.external === true && i.kind === "require-call"), JSON.stringify(extImps.filter((i: any) => i.external === true).slice(0, 2)));

const outs = Object.values(mf.outputs) as any[];
const outKeys = Object.keys(outs[0]).sort().join(",");
check("P5 output keys bytes/inputs/imports/exports/entryPoint/cssBundle", outKeys === "bytes,cssBundle,entryPoint,exports,imports,inputs", outKeys);
const jsOut = outs.find((o: any) => o.entryPoint) as any;
check("P5a entryPoint + cssBundle", jsOut.entryPoint === F + "/entry.ts" && jsOut.cssBundle === "./entry.css", "entry=" + jsOut.entryPoint + " css=" + jsOut.cssBundle);
const contrib = Object.entries(jsOut.inputs).map(([p, v]: any) => typeof (v as any).bytesInOutput === "number");
check("P5b outputs.inputs byte contribution", contrib.length >= 2 && contrib.every(Boolean), JSON.stringify(jsOut.inputs));
check("P5c exports list", Array.isArray(jsOut.exports) && jsOut.exports.includes("main"), JSON.stringify(jsOut.exports));

check("P6 dead import() chunk omitted", !Object.keys(mf.outputs).some((p: string) => p.includes("dead")), JSON.stringify(Object.keys(mf.outputs)));

// P7 CORRECTION (pinned): the pasted claim says treeShaking:false forces
// import() chunks to appear — on 1.4.0 the dead branch is eliminated
// REGARDLESS of treeShaking (also with an unused () => import() export).
const resNoShake = await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/meta-out4", metafile: true, treeShaking: false });
check("P7 treeShaking:false does NOT force dead chunks", !Object.keys(resNoShake.metafile!.outputs).some((p: string) => p.includes("dead")), JSON.stringify(Object.keys(resNoShake.metafile!.outputs)));

// P8 CLI --metafile=path.json produces the same schema.
const cli = Bun.spawnSync(["bun", "build", F + "/entry.ts", "--outdir", "scratch/meta-cli", "--metafile=scratch/meta-cli/meta.json"], { stdout: "ignore", stderr: "ignore" });
const cliMf = await Bun.file("scratch/meta-cli/meta.json").json();
check("P8 CLI --metafile schema", cli.exitCode === 0 && "inputs" in cliMf && "outputs" in cliMf && "entryPoint" in (Object.values(cliMf.outputs as any)[0] as object), "exit=" + cli.exitCode);


// ── §155 addendum: --metafile-md FILENAME behavior (pasted claims vs 1.4.0) ──

// The pasted claim says the default meta.md lands in --outdir. On 1.4.0
// ALL metafile outputs land in the PROCESS CWD (spawn cwd here), and a
// bare --metafile defaults to meta.json (the claim says no default).
const mfCwd = "scratch/mf-cwd";
await Bun.write(mfCwd + "/.keep", "");
const spawnCli = (args: string[], cwd: string) => Bun.spawnSync(["bun", "build", process.cwd() + "/" + F + "/entry.ts", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
const w = (p: string) => Bun.file(p).exists();

// P9: bare --metafile-md -> meta.md in CWD (NOT the outdir).
spawnCli(["--metafile-md", "--outdir=dist"], mfCwd);
check("P9 bare --metafile-md -> meta.md in CWD", (await w(mfCwd + "/meta.md")) && !(await w(mfCwd + "/dist/meta.md")), "cwd-meta.md=" + (await w(mfCwd + "/meta.md")));

// P10: --metafile-md=custom.md resolves against CWD.
spawnCli(["--metafile-md=custom.md", "--outdir=dist"], mfCwd);
check("P10 custom --metafile-md path in CWD", await w(mfCwd + "/custom.md"), "");

// P11: --metafile + --metafile-md together -> both files.
spawnCli(["--metafile=meta.json", "--metafile-md=meta.md", "--outdir=dist"], mfCwd);
check("P11 both flags together", (await w(mfCwd + "/meta.json")) && (await w(mfCwd + "/meta.md")), "");

// P12: bare --metafile HAS a default (meta.json in CWD) — the pasted
// claim says "always pass a path"; the default exists on 1.4.0.
spawnCli(["--metafile", "--outdir=dist"], mfCwd);
check("P12 bare --metafile defaults to meta.json", await w(mfCwd + "/meta.json"), "");

// P13: absolute paths (the repo design:build form) write where asked.
spawnCli(["--metafile-md=" + process.cwd() + "/" + mfCwd + "/abs.md", "--outdir=dist"], mfCwd);
check("P13 absolute --metafile-md path", await w(mfCwd + "/abs.md"), "");



// ── §155 addendum 2: API object/string metafile forms ──

// The object form { json, markdown } writes BOTH files relative to the
// OUTDIR (no CLI CWD quirk) and res.metafile stays populated; the string
// form writes the JSON only. Used by design:build (one build call, no
// subprocess).
await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/mf-obj/dist", metafile: { json: "meta.json", markdown: "meta.md" } as any });
check("P14 object form writes json+markdown in outdir", (await w("scratch/mf-obj/dist/meta.json")) && (await w("scratch/mf-obj/dist/meta.md")), "");
const resObj = await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/mf-obj2/dist", metafile: { json: "meta.json" } as any });
check("P15 object json-only + res.metafile populated", (await w("scratch/mf-obj2/dist/meta.json")) && !!resObj.metafile && "inputs" in resObj.metafile, "keys=" + (resObj.metafile ? Object.keys(resObj.metafile).join(",") : "null"));
await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/mf-obj3/dist", metafile: "meta.json" as any });
check("P16 string form writes json in outdir", await w("scratch/mf-obj3/dist/meta.json"), "");



// ── §155 addendum 3: REPORT CONTENT claims ──

// The object form report has the six claimed sections, but with
// deviations: the Largest section is named "Largest Modules by Output
// Contribution", Quick Summary counts ESM only (no CJS, no output/
// input ratio), and the grep marker is [OUTPUT_BYTES:] not [SIZE:].
const rpt = await Bun.file("scratch/mf-obj/dist/meta.md").text();
const sections = ["Quick Summary", "Largest Modules by Output Contribution", "Entry Point Analysis", "Dependency Chains", "Full Module Graph", "Raw Data for Searching"];
check("P17 six report sections present", sections.every((s) => rpt.includes("## " + s)), sections.filter((s) => !rpt.includes("## " + s)).join(",") || "all");
check("P18 quick summary has output size + ESM count", rpt.includes("Total output size") && /ESM modules/.test(rpt), "");
check("P19 grep markers MODULE/IMPORT/OUTPUT_BYTES", rpt.includes("[MODULE:") && rpt.includes("[IMPORT:") && rpt.includes("[OUTPUT_BYTES:"), "");
check("P20 pinned deviations: no [SIZE:], no ratio, named section", !rpt.includes("[SIZE:") && !/ratio/i.test(rpt) && rpt.includes("Largest Modules by Output Contribution"), "");



// ── §155 addendum 4: define-gated tree shaking, outputs.imports, builtins ──

// define-gated import() is dropped like if(false); treeShaking:false does
// NOT keep it (contradicts the pasted claim, matches pinned P7).
// outputs.imports is ALWAYS EMPTY on 1.4.0 (the schema field never
// populates, even with external imports in the output JS). Node builtins
// are BUNDLED into the output (esbuild keeps them external).
await Bun.write(F + "/feature.ts", 'import { SHARED } from "./shared.ts";\nif (FEATURE) { await import("./dead.ts"); }\nexport const main = () => SHARED;\n');
const rFeat = await Bun.build({ entrypoints: [F + "/feature.ts"], outdir: "scratch/mf-f/dist", metafile: true, define: { FEATURE: "false" } });
check("P21 define-gated import() chunk dropped", !Object.keys(rFeat.metafile!.outputs).some((p: string) => p.includes("dead")), "");
const rFeat2 = await Bun.build({ entrypoints: [F + "/feature.ts"], outdir: "scratch/mf-f2/dist", metafile: true, define: { FEATURE: "false" }, treeShaking: false });
check("P22 define-gated + treeShaking:false STILL dropped", !Object.keys(rFeat2.metafile!.outputs).some((p: string) => p.includes("dead")), "");
const rExt = await Bun.build({ entrypoints: [F + "/ext.ts"], outdir: "scratch/mf-ext5/dist", metafile: true, external: ["typescript"] });
const extOut = Object.values(rExt.metafile!.outputs)[0] as any;
check("P23 outputs.imports always empty (pinned)", Array.isArray(extOut.imports) && extOut.imports.length === 0, "len=" + extOut.imports.length);
const nodeOut = Object.values(rExt.metafile!.outputs)[0] as any;
check("P24 node builtins BUNDLED (inputs includes node:path)", Object.keys(nodeOut.inputs).some((p: string) => p === "node:path"), Object.keys(nodeOut.inputs).join(","));
const jsStr = JSON.stringify(rExt.metafile);
await Bun.write("scratch/mf-ext5/dist/meta.json", jsStr);
check("P25 JSON.stringify + Bun.write round-trip", jsStr.startsWith("{\"inputs\":") && await w("scratch/mf-ext5/dist/meta.json"), "len=" + jsStr.length);



// P26: the pasted Bun.write relative-path form — resolves against the
// process CWD (same as the CLI metafile outputs).
const resRel = await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/mf-rel/dist", metafile: true });
await Bun.write("scratch/mf-rel/meta.json", JSON.stringify(resRel.metafile));
const relMf = await Bun.file("scratch/mf-rel/meta.json").json();
check("P26 Bun.write relative path (CWD-resolved)", "inputs" in relMf && "outputs" in relMf, "");



// ── §155 addendum 5: bunfig absence, pretty-print, env gating ──

// No bunfig.toml [build] metafile key — a [build] metafile = true is
// IGNORED (build emits no metafile). metafile is per-call/CLI only.
// Pretty-print and metafile:false (env gating) verified.
const bunfigDir = "scratch/mf-bunfig";
await Bun.write(bunfigDir + "/bunfig.toml", "[build]\nmetafile = true\n");
const bf = Bun.spawnSync(["bun", "build", process.cwd() + "/" + F + "/entry.ts", "--outdir=dist"], { cwd: bunfigDir, stdout: "ignore", stderr: "ignore" });
check("P27 bunfig [build] metafile IGNORED", bf.exitCode === 0 && !(await w(bunfigDir + "/dist/meta.json")), "exit=" + bf.exitCode);
const resPP = await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/mf-pp/dist", metafile: true });
const pretty = JSON.stringify(resPP.metafile, null, 2);
check("P28 pretty-print indents", pretty.includes("\n  \"inputs\":"), "");
const resOff = await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/mf-off/dist", metafile: false });
check("P28a metafile:false accepted (env gating)", resOff.success && resOff.metafile === undefined, String(typeof resOff.metafile));



// ── §155 addendum 6: BuildOutput / BuildArtifact surface ──

// BuildArtifact is Blob-CONFORMANT but NOT instanceof Blob; .bytes()
// does not exist on it; .sourcemap points at the CSS asset here (not
// the .map); sourcemaps are separate outputs with kind sourcemap.
// Consolidated + evidence-grounded: docs/BUN_BUILD_FINDINGS.md (177).
const resArt = await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/mf-art/dist", minify: true, sourcemap: "external", naming: "x/[name]-[hash].[ext]" });
const art = resArt.outputs[0] as any;
check("P29 artifact kind/loader/hash", art.kind === "entry-point" && art.loader === "ts" && typeof art.hash === "string" && art.hash.length > 0, "kind=" + art.kind + " hash=" + art.hash);
check("P30 artifact is Blob-conformant NOT instanceof Blob", art instanceof Blob === false && art.size > 0 && typeof art.type === "string" && typeof art.text === "function" && typeof art.arrayBuffer === "function" && typeof (art as any).bytes === "undefined", "isBlob=" + (art instanceof Blob) + " bytes=" + typeof (art as any).bytes);
const kinds = resArt.outputs.map((o: any) => o.kind);
check("P31 kinds incl sourcemap + asset", kinds.includes("sourcemap") && kinds.includes("asset") && kinds.includes("entry-point"), kinds.join(","));
check("P32 artifact.sourcemap NOT the .map (misassigned)", !(art.sourcemap && art.sourcemap.path?.endsWith(".map")), "sm=" + (art.sourcemap ? art.sourcemap.path.split("/").pop() : "null"));






// P34 CORRECTION: the object-form metafile resolves json/markdown paths
// against the OUTDIR — even ABSOLUTE paths get outdir-prefixed (writes
// land at outdir/<abs-path>). Use relative names for outdir-relative
// output; §155's absolute-path claim was wrong for the object form.
await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: "scratch/mf-abs/dist", metafile: { json: process.cwd() + "/scratch/mf-abs/abs.json" } as any });
check("P34 object-form absolute path lands under OUTDIR", (await w("scratch/mf-abs/dist" + process.cwd() + "/scratch/mf-abs/abs.json")) || !(await w(process.cwd() + "/scratch/mf-abs/abs.json")), "");


const failed = results.filter((r) => !r.pass);
console.log("metafile:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
