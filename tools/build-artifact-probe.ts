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
 * In-process (Bun.build API, no spawn). Own fixture dir.
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
const wo1 = withOut.outputs[0];
check("P1a with outdir: path points into outdir", wo1.path.includes(F + "/out"), wo1.path);
check("P1b file written to disk", (await Bun.file(wo1.path).exists()) === true, "exists=true");
const noOut = await Bun.build({ entrypoints: [F + "/entry.ts"] });
const wo2 = noOut.outputs[0];
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
check("P3a default naming hash present", def.outputs[0].hash !== null && def.outputs[0].hash !== undefined, "hash=" + String(def.outputs[0].hash).slice(0, 12));

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
check("P8 Blob-like surface: size/type/text/arrayBuffer/stream present", typeof def.outputs[0].size === "number" && typeof def.outputs[0].type === "string" && typeof def.outputs[0].text === "function" && typeof def.outputs[0].arrayBuffer === "function" && typeof def.outputs[0].stream === "function", "size=" + typeof def.outputs[0].size + " type=" + typeof def.outputs[0].type + " stream=" + typeof def.outputs[0].stream);
check("P8a extends Blob: FALSE on 1.4.0 (docs corrected)", (def.outputs[0] as any) instanceof Blob === false && typeof (def.outputs[0] as any).bytes === "undefined", "instanceof=" + String(def.outputs[0] instanceof Blob) + " bytes=" + String(typeof (def.outputs[0] as any).bytes));
check("P9 loader reflects the SOURCE loader", def.outputs[0].loader === "ts", "loader=" + String(def.outputs[0].loader));
check("P10 entry-point hash NOT null (docs corrected - null-by-default is wrong)", def.outputs[0].hash !== null && def.outputs[0].hash !== undefined, "hash=" + String(def.outputs[0].hash));
const bc = await safe({ entrypoints: [F + "/pure.ts"], outdir: F + "/outbc", bytecode: true });
const bcKinds = bc.ok ? bc.r.outputs.map((o: any) => o.kind) : ["build-failed"];
check("P11 bytecode:true yields a bytecode-kind output", bcKinds.includes("bytecode"), bcKinds.join(","));
const nestedSm = sm.ok ? (sm.r.outputs.find((o: any) => o.kind === "entry-point") as any)?.sourcemap : undefined;
let nestedText = "";
if (nestedSm) nestedText = await nestedSm.text();
check("P12 nested sourcemap .text() returns map JSON", typeof nestedText === "string" && nestedText.includes("version") && nestedText.includes("sources"), nestedText.slice(0, 40));

const failed = results.filter((r) => !r.pass);
console.log("build-artifact:probe - " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
