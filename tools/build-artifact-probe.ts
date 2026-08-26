#!/usr/bin/env bun
/**
 * bun run build-artifact:probe - BuildArtifact gotchas (§177), probing
 * the seven documented claims on the pinned 1.4.0:
 *   P1 path semantics with/without outdir (+ .bytes() correction)
 *   P2 no outdir -> nothing written to disk
 *   P3 hash can be null (naming without [hash])
 *   P4 sourcemap nested artifact or null
 *   P5 kind varies (entry-point/chunk/asset/sourcemap)
 *   P6 Response(artifact): Content-Type set; Cache-Control NOT; Etag
 *      NOT on 1.4.0 (§176 correction)
 *   P7 naming affects entrypoints only unless the object form
 * Plus evidence pinning (P17-P19, 177 refactor): the committed
 * tools/build-artifact-evidence.json must match the runtime version
 * and the live artifact surface; the findings doc must reference the
 * pinned revision. In-process (Bun.build API, no spawn). Own fixture dir.
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  - " + detail : "")); };
const F = "scratch/art-probe";
await Bun.write(F + "/entry.ts", 'import { shared } from "./shared.ts";\nimport "./style.css";\nexport const main = () => shared();\n');
await Bun.write(F + "/entry2.ts", 'import { shared } from "./shared.ts";\nexport const other = () => shared() * 2;\n');
await Bun.write(F + "/pure.ts", 'import { shared } from "./shared.ts";\nexport const pure = () => shared() + 1;\n');
await Bun.write(F + "/pure2.ts", 'import { shared } from "./shared.ts";\nexport const pure2 = () => shared() + 2;\n');
await Bun.write(F + "/shared.ts", "export const shared = () => 42;\n");
await Bun.write(F + "/style.css", "body { color: red; }\n");

const safe = async (opts: any): Promise<{ ok: boolean; r: any; err: string }> => {
  try {
    const r = await Bun.build(opts);
    return { ok: true, r, err: "" };
  } catch (err) {
    return { ok: false, r: null, err: String(err).slice(0, 70) };
  }
};

// P1/P2: outdir vs no-outdir semantics.
const withOut = await Bun.build({ entrypoints: [F + "/entry.ts"], outdir: F + "/out" });
const wo1 = withOut.outputs[0]!!;
check("P1a with outdir: path points into outdir", wo1.path.includes(F + "/out"), wo1.path);
check("P1b file written to disk", (await Bun.file(wo1.path).exists()) === true, "exists=true");
const noOut = await Bun.build({ entrypoints: [F + "/entry.ts"] });
const wo2 = noOut.outputs[0]!;
check("P1c without outdir: path is a bare name", !wo2.path.includes("/out"), wo2.path);
const wo2Exists = await Bun.file(wo2.path).exists();
check("P2 no outdir writes nothing to disk", wo2Exists === false, "exists=" + wo2Exists + " path=" + wo2.path);
check("P1d content via .text() without outdir", (await wo2.text()).includes("shared"), (await wo2.text()).slice(0, 40));
check("P1e .bytes() NOT available on 1.4.0 (docs corrected)", typeof (wo2 as any).bytes === "undefined", "bytes=" + String(typeof (wo2 as any).bytes));

// P3: the claim "hash can be null" is WRONG on 1.4.0 for naming without
// [hash] - the hash is still computed. The real no-content-hash case is
// SOURCEMAP artifacts, which get a 00000000 placeholder.
const named = await safe({ entrypoints: [F + "/pure.ts"], outdir: F + "/out2", naming: "static/[name].js" });
check("P3 hash NOT null with hash-less naming (docs corrected)", named.ok && named.r.outputs[0].hash !== null && named.r.outputs[0].hash !== undefined, named.ok ? "hash=" + String(named.r.outputs[0].hash) : named.err);
const def = await Bun.build({ entrypoints: [F + "/pure.ts"], outdir: F + "/out3" });
check("P3a default naming hash present", def.outputs[0]!.hash !== null && def.outputs[0]!.hash !== undefined, "hash=" + String(def.outputs[0]!.hash).slice(0, 12));

// P4: sourcemap nested artifact or null.
const sm = await safe({ entrypoints: [F + "/pure.ts"], outdir: F + "/out4", sourcemap: "external" });
const smKinds = sm.ok ? sm.r.outputs.map((o: any) => o.kind) : ["build-failed"];
const smArt = sm.ok ? sm.r.outputs.find((o: any) => o.kind === "sourcemap") : undefined;
const srcMapProp = sm.ok ? (sm.r.outputs[0] as any).sourcemap : undefined;
check("P4a sourcemap:external emits a sourcemap-kind artifact", !!smArt, "kinds=" + smKinds.join(","));
const smHashes = sm.ok ? sm.r.outputs.filter((o: any) => o.kind === "sourcemap").map((o: any) => String(o.hash)) : [];
check("P3b sourcemap artifacts get the 00000000 placeholder hash", smHashes.length > 0 && smHashes.every((h: string) => h === "00000000"), smHashes.join(","));
check("P4b artifact.sourcemap nested BuildArtifact or null", srcMapProp === null || (srcMapProp && typeof srcMapProp.text === "function"), "sourcemap=" + String(srcMapProp && srcMapProp.constructor ? srcMapProp.constructor.name : srcMapProp));
const none = await Bun.build({ entrypoints: [F + "/pure.ts"], outdir: F + "/out5" });
check("P4c sourcemap:none -> no sourcemap output", !none.outputs.some((o: any) => o.kind === "sourcemap"), "kinds=" + none.outputs.map((o: any) => o.kind).join(","));

// P5: kind variants (splitting + asset).
const split = await safe({ entrypoints: [F + "/entry.ts", F + "/entry2.ts"], outdir: F + "/out6", splitting: true });
const splitKinds = split.ok ? split.r.outputs.map((o: any) => o.kind) : ["build-failed"];
check("P5 splitting yields entry-point + chunk kinds", splitKinds.includes("entry-point") && splitKinds.includes("chunk"), splitKinds.join(","));
check("P5a css import yields an asset-kind output", smKinds.includes("asset") || splitKinds.includes("asset"), "sm=" + smKinds.join(",") + " split=" + splitKinds.join(","));

// P6: Response(artifact) headers - Content-Type set, Cache-Control NOT, Etag NOT (§176).
const r6 = new Response(none.outputs[0]);
check("P6 Content-Type set, Cache-Control NOT, Etag NOT (1.4.0)", r6.headers.get("content-type") !== null && r6.headers.get("cache-control") === null && r6.headers.get("etag") === null, "ct=" + String(r6.headers.get("content-type")) + " cc=" + String(r6.headers.get("cache-control")));

// P7: naming - entrypoints only by default; chunks need the object form.
const nm7 = await safe({ entrypoints: [F + "/pure.ts", F + "/pure2.ts"], outdir: F + "/out7", splitting: true, naming: "static/[name].js" });
const e7 = nm7.ok ? nm7.r.outputs.find((o: any) => o.kind === "entry-point") : undefined;
const c7 = nm7.ok ? nm7.r.outputs.find((o: any) => o.kind === "chunk") : undefined;
check("P7a entrypoint honors the naming string", nm7.ok && !!e7 && e7.path.includes("static/"), nm7.ok ? (e7 ? e7.path : "no entry") : nm7.err);
check("P7b chunk does NOT get the naming string", nm7.ok && !!c7 && !c7.path.includes("static/"), nm7.ok ? (c7 ? c7.path : "no chunk") : nm7.err);
const obj7 = await safe({ entrypoints: [F + "/pure.ts", F + "/pure2.ts"], outdir: F + "/out8", splitting: true, naming: { entry: "e/[name].js", chunk: "c/[name].js", asset: "a/[name].js" } });
const e8 = obj7.ok ? obj7.r.outputs.find((o: any) => o.kind === "entry-point") : undefined;
const c8 = obj7.ok ? obj7.r.outputs.find((o: any) => o.kind === "chunk") : undefined;
check("P7c object naming applies to entry + chunk", obj7.ok && !!e8 && e8.path.includes("e/") && !!c8 && c8.path.includes("c/"), obj7.ok ? "entry=" + String(e8?.path) + " chunk=" + String(c8?.path) : obj7.err);

// P8-P12: the full BuildArtifact shape claims (§177).
check("P8 Blob-like surface: size/type/text/arrayBuffer/stream present", typeof def.outputs[0]!.size === "number" && typeof def.outputs[0]!.type === "string" && typeof def.outputs[0]!.text === "function" && typeof def.outputs[0]!.arrayBuffer === "function" && typeof def.outputs[0]!.stream === "function", "size=" + typeof def.outputs[0]!.size + " type=" + typeof def.outputs[0]!.type + " stream=" + typeof def.outputs[0]!.stream);
check("P8a extends Blob: FALSE on 1.4.0 (docs corrected)", (def.outputs[0]! as any) instanceof Blob === false && typeof (def.outputs[0]! as any).bytes === "undefined", "instanceof=" + String(def.outputs[0]! instanceof Blob) + " bytes=" + String(typeof (def.outputs[0]! as any).bytes));
check("P9 loader reflects the SOURCE loader", def.outputs[0]!.loader === "ts", "loader=" + String(def.outputs[0]!.loader));
check("P10 entry-point hash NOT null (docs corrected - null-by-default is wrong)", def.outputs[0]!.hash !== null && def.outputs[0]!.hash !== undefined, "hash=" + String(def.outputs[0]!.hash));
const bc = await safe({ entrypoints: [F + "/pure.ts"], outdir: F + "/outbc", bytecode: true });
const bcKinds = bc.ok ? bc.r.outputs.map((o: any) => o.kind) : ["build-failed"];
check("P11 bytecode:true yields a bytecode-kind output", bcKinds.includes("bytecode"), bcKinds.join(","));
const nestedSm = sm.ok ? (sm.r.outputs.find((o: any) => o.kind === "entry-point") as any)?.sourcemap : undefined;
let nestedText = "";
if (nestedSm) nestedText = await nestedSm.text();
check("P12 nested sourcemap .text() returns map JSON", typeof nestedText === "string" && nestedText.includes("version") && nestedText.includes("sources"), nestedText.slice(0, 40));

// P13-P16: naming/sourcemap/loader option interactions (§177).
check("P13 default naming: entry path has NO hash", !withOut.outputs[0]!.path.includes(String(withOut.outputs[0]!.hash)), "path=" + withOut.outputs[0]!.path.split("/").pop());
const chunkOf = split.ok ? split.r.outputs.find((o: any) => o.kind === "chunk") : undefined;
check("P13a chunk embeds its hash in the path ([name]-[hash].[ext])", !!chunkOf && chunkOf.path.includes(String(chunkOf.hash)), chunkOf ? chunkOf.path.split("/").pop() : "no chunk");
const cssArt = split.ok ? split.r.outputs.find((o: any) => o.kind === "asset") : undefined;
check("P13b CSS bundle NOT hashed by default (docs corrected - [name].[ext])", !!cssArt && !cssArt.path.includes(String(cssArt.hash)), cssArt ? cssArt.path.split("/").pop() : "no css asset");
await Bun.write(F + "/pix.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
await Bun.write(F + "/png.ts", 'import p from "./pix.png";\nexport const png = p;\n');
const pngB = await safe({ entrypoints: [F + "/png.ts"], outdir: F + "/outpng" });
const pngArt = pngB.ok ? pngB.r.outputs.find((o: any) => o.kind === "asset") : undefined;
check("P13c file-loader asset (png) IS hashed", !!pngArt && pngArt.loader === "file" && pngArt.path.includes(String(pngArt.hash)), pngArt ? pngArt.path.split("/").pop() : (pngB.ok ? "no asset; outputs=" + pngB.r.outputs.map((o: any) => o.kind).join(",") : "ERR: " + pngB.err));
const lk = await safe({ entrypoints: [F + "/pure.ts"], outdir: F + "/outlk", sourcemap: "linked" });
const lkJs = lk.ok && lk.r.outputs.find((o: any) => o.kind === "entry-point") ? await lk.r.outputs.find((o: any) => o.kind === "entry-point").text() : "";
check("P15 sourcemap:linked emits artifact + sourceMappingURL comment", lk.ok && lk.r.outputs.some((o: any) => o.kind === "sourcemap") && lkJs.includes("sourceMappingURL"), "kinds=" + (lk.ok ? lk.r.outputs.map((o: any) => o.kind).join(",") : lk.err));
const exEntry = sm.ok ? sm.r.outputs.find((o: any) => o.kind === "entry-point") : undefined;
const exJs = exEntry ? await exEntry.text() : "";
check("P15a sourcemap:external emits artifact, NO linking comment", sm.ok && sm.r.outputs.some((o: any) => o.kind === "sourcemap") && !exJs.includes("sourceMappingURL"), "comment=" + exJs.includes("sourceMappingURL"));
const inl = await safe({ entrypoints: [F + "/pure.ts"], outdir: F + "/outin", sourcemap: "inline" });
const inlEntry = inl.ok ? inl.r.outputs.find((o: any) => o.kind === "entry-point") : undefined;
const inlJs = inlEntry ? await inlEntry.text() : "";
check("P15b sourcemap:inline -> sourcemap null, map base64-embedded", inl.ok && (inlEntry as any).sourcemap === null && !inl.r.outputs.some((o: any) => o.kind === "sourcemap") && (inlJs.includes("base64") || inlJs.includes("data:application/json")), "hasSeparateMap=" + inl.r.outputs.some((o: any) => o.kind === "sourcemap"));
await Bun.write(F + "/blob.xyz", "BLOB-CONTENT-123");
await Bun.write(F + "/d2.ts", 'import blob from "./blob.xyz";\nexport const b = blob;\n');
const ldFile = await safe({ entrypoints: [F + "/d2.ts"], outdir: F + "/outld" });
const fileArt = ldFile.ok ? ldFile.r.outputs.find((o: any) => o.kind === "asset") : undefined;
check("P16 default .xyz -> file-loader hashed asset", !!fileArt && fileArt.loader === "file" && fileArt.path.includes(String(fileArt.hash)), fileArt ? fileArt.path.split("/").pop() : (ldFile.ok ? "no asset; outputs=" + ldFile.r.outputs.map((o: any) => o.kind).join(",") : "ERR: " + ldFile.err));
const ldText = await safe({ entrypoints: [F + "/d2.ts"], outdir: F + "/outld2", loader: { ".xyz": "text" } });
const ldJs = ldText.ok ? await ldText.r.outputs[0].text() : "";
check("P16a loader {.xyz: text} inlines the file (no artifact)", ldText.ok && ldText.r.outputs.length === 1 && ldJs.includes("BLOB-CONTENT-123"), "outputs=" + (ldText.ok ? ldText.r.outputs.length : ldText.err));

// P17-P19: evidence pinning (177 refactor) - the committed evidence JSON
// is the grounding for docs/BUN_BUILD_FINDINGS.md; it must stay in sync
// with the installed runtime, else the gate fails.
const evFile = await Bun.file("tools/build-artifact-evidence.json").json();
check("P17 evidence JSON matches runtime version/revision", evFile.bunVersion === Bun.version && evFile.bunRevision === Bun.revision, evFile.bunVersion + "@" + String(evFile.bunRevision).slice(0, 9));
const evM = evFile.surface ? evFile.surface.methods : null;
check("P18 evidence surface agrees with live artifact surface", evM !== null && evM.text === true && evM.bytes === false && evM.formData === false && evM.image === false && evM.instanceofBlob === false, evM ? JSON.stringify(evM) : "no surface in evidence");
const docText = await Bun.file("docs/BUN_BUILD_FINDINGS.md").text();
const revShort = String(evFile.bunRevision).slice(0, 9);
check("P19 findings doc references the pinned revision", docText.includes(revShort) && docText.includes("## 1. BuildArtifact"), revShort);

// P20-P22: BuildArtifact.slice() gotchas (177 refactor) - plain Blob return,
// byte offsets, and the NEGATIVE-offset deviation with outdir.
const sliceArt = withOut.outputs[0]! as any;
const sliceNoOutArt = noOut.outputs[0] as any;
const sliceFullText = await sliceArt.text();
const sliced = sliceArt.slice(0, 10) as any;
const slicedAny = sliced as any;
check("P20 slice returns a plain Blob (props lost)", typeof sliceArt.slice === 'function' && sliced instanceof Blob && slicedAny.kind === undefined && slicedAny.path === undefined && slicedAny.hash === undefined && slicedAny.loader === undefined && slicedAny.sourcemap === undefined && typeof sliced.bytes === 'function', "isBlob=" + (sliced instanceof Blob) + " bytes=" + typeof sliced.bytes);
check("P21 byte offsets match Blob.slice for non-negative", (await sliceArt.slice(2, 6).text()) === sliceFullText.slice(2, 6) && (await sliceArt.slice(0, 10).text()) === (await new Blob([sliceFullText]).slice(0, 10).text()), JSON.stringify(await sliceArt.slice(2, 6).text()));
const negW = (await sliceArt.slice(-4).text()).length;
const negN = (await sliceNoOutArt.slice(-4).text()).length;
const negB = (await new Blob([sliceFullText]).slice(-4).text()).length;
const endW = (await sliceArt.slice(0, -4).text()).length;
const endB = (await new Blob([sliceFullText]).slice(0, -4).text()).length;
check("P22 NEGATIVE offsets deviate with outdir (docs corrected)", negW === 0 && negN === negB && negN === 4 && endW === sliceFullText.length && endB === sliceFullText.length - 4, "withOutdir slice(-4)=" + negW + " noOutdir=" + negN + " blob=" + negB + " slice(0,-4) withOutdir=" + endW + " blob=" + endB);

// P23-P31 (178 refactor): BuildConfig options surfaced by the reference cross-check.
const gF = 'scratch/art-ground-cfg2';
await Bun.write(gF + '/pure.ts', 'export const pure = () => 42;');
await Bun.write(gF + '/missing.ts', 'import "./does-not-exist.ts";');
await Bun.write(gF + '/zod.ts', 'import { z } from "zod"; export const s = z.string();');
await Bun.write(gF + '/feat.ts', 'import { feature } from "bun:bundle"; export const v = feature("FEAT_A") ? "A" : "B";');
await Bun.write(gF + '/src/pure.ts', 'export const pure = () => 42;');
await Bun.write(gF + '/tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
await Bun.write(gF + '/alias.ts', 'import { pure } from "@/pure"; export const v = pure();');
await Bun.write(gF + '/el.tsx', 'export const el = <div id="x" />;');
await Bun.write(gF + '/dce.ts', 'function impure() { return 1; } /* @__PURE__ */ impure(); export const y = 1;');
const gText = async (opts: any) => { try { const r = await Bun.build(opts); return await r.outputs[0]!.text(); } catch (e: any) { return 'ERR ' + String(e.message ?? e).slice(0, 40); } };
const gSafe = async (opts: any) => { try { await Bun.build(opts); return true; } catch { return false; } };
const bfT = await gText({ entrypoints: [gF + '/pure.ts'], outdir: gF + '/o1', banner: '/*BANNER*/', footer: '/*FOOTER*/' });
check('P23 banner/footer emitted', bfT.includes('/*BANNER*/') && bfT.trimEnd().includes('/*FOOTER*/'), bfT.slice(0, 20) + '...');
const thrR = await Bun.build({ entrypoints: [gF + '/missing.ts'], outdir: gF + '/o2', throw: false });
check('P24 throw:false returns success:false (no reject)', thrR.success === false && thrR.logs.length >= 1, 'success=' + thrR.success + ' logs=' + thrR.logs.length);
const pkgsT = await gText({ entrypoints: [gF + '/zod.ts'], outdir: gF + '/o3', packages: 'external' });
check('P25 packages:external keeps imports external', pkgsT.includes('from "zod"'), 'len=' + pkgsT.length);
const featA = await gText({ entrypoints: [gF + '/feat.ts'], outdir: gF + '/o4a', features: ['FEAT_A'] });
const feat0 = await gText({ entrypoints: [gF + '/feat.ts'], outdir: gF + '/o4b' });
check('P26 features dead-code elimination', featA.includes('"A"') && !featA.includes('"B"') && feat0.includes('"B"') && !feat0.includes('"A"'), 'with=' + featA.slice(-30) + ' without=' + feat0.slice(-30));
check('P27 tsconfig paths alias resolves', await gSafe({ entrypoints: [gF + '/alias.ts'], outdir: gF + '/o5', tsconfig: gF + '/tsconfig.json' }), '@/pure -> src/pure.ts');
const jsxT = await gText({ entrypoints: [gF + '/el.tsx'], outdir: gF + '/o6', jsx: { runtime: 'classic', factory: 'h' } });
check('P28 jsx classic factory honored', jsxT.includes('h("div"'), jsxT.slice(0, 60));
const dce1 = await gText({ entrypoints: [gF + '/dce.ts'], outdir: gF + '/o7', minify: { syntax: true, whitespace: true } });
const dce2 = await gText({ entrypoints: [gF + '/dce.ts'], outdir: gF + '/o7b', minify: { syntax: true, whitespace: true }, ignoreDCEAnnotations: true });
check('P29 ignoreDCEAnnotations keeps @__PURE__ calls', !dce1.includes('impure') && dce2.includes('impure()'), 'drop=' + (!dce1.includes('impure')) + ' keep=' + dce2.includes('impure()'));

// P30-P33 (178): react transform options + virtual files - grounded with a
// fake-react fixture (no npm deps). Dollar markers built via char code.
const gR = 'scratch/art-ground-cfg3';
await Bun.write(gR + '/node_modules/react/package.json', JSON.stringify({ name: 'react', version: '19.0.0', exports: { '.': './index.js', './jsx-runtime': './jsx-runtime.js', './jsx-dev-runtime': './jsx-dev-runtime.js', './compiler-runtime': './compiler-runtime.js' } }));
await Bun.write(gR + '/node_modules/react/compiler-runtime.js', 'export const useMemoCache = (x) => x;');
await Bun.write(gR + '/node_modules/react/index.js', 'export const useState = (x) => [x, () => {}]; export default {};');
await Bun.write(gR + '/node_modules/react/jsx-runtime.js', 'export const jsx = (t, p) => [t, p]; export const jsxs = (t, p) => [t, p]; export const Fragment = Symbol.for("react.fragment");');
await Bun.write(gR + '/node_modules/react/jsx-dev-runtime.js', 'export const jsxDEV = (t, p) => [t, p]; export const Fragment = Symbol.for("react.fragment");');
await Bun.write(gR + '/component.tsx', 'import { useState } from "react"; export function C({ x }: any) { const [n, setN] = useState(x); return <div onClick={() => setN(n + 1)}>{n}</div>; }');
const rJ = { entrypoints: [gR + '/component.tsx'], outdir: gR + '/rj', jsx: { runtime: 'automatic', importSource: 'react' } };
const rBase = await gText(rJ);
const rFast = await gText({ ...rJ, outdir: gR + '/rj1', reactFastRefresh: true });
const rComp = await gText({ ...rJ, outdir: gR + '/rj2', reactCompiler: true });
const rSsr = await gText({ ...rJ, outdir: gR + '/rj3', reactCompiler: true, reactCompilerOutputMode: 'ssr' });
const rClient = await gText({ ...rJ, outdir: gR + '/rj4', reactCompiler: true, reactCompilerOutputMode: 'client' });
const DL = String.fromCharCode(36);
check('P30 reactFastRefresh adds refresh markers', rFast !== rBase && (rFast.includes(DL + 'RefreshSig' + DL) || rFast.includes(DL + 'RefreshReg' + DL)), 'differs=' + (rFast !== rBase));
check('P31 reactCompiler adds memoization guards', rComp !== rBase && rComp.includes(DL + '['), 'differs=' + (rComp !== rBase));
check('P32 reactCompilerOutputMode ssr != client', rSsr !== rClient, rSsr.length + ' vs ' + rClient.length);
const vf = await gSafe({ entrypoints: ['/app/index.ts'], outdir: gR + '/rj5', files: { '/app/index.ts': 'export const m = 1;' } });
check('P33 files: virtual in-memory bundling', vf, 'virtual entry /app/index.ts');

const failed = results.filter((r) => !r.pass);
console.log("build-artifact:probe - " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};