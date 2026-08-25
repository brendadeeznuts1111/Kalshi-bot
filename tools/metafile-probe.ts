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
const cliMf = JSON.parse(await Bun.file("scratch/meta-cli/meta.json").text());
check("P8 CLI --metafile schema", cli.exitCode === 0 && "inputs" in cliMf && "outputs" in cliMf && "entryPoint" in (Object.values(cliMf.outputs as any)[0] as object), "exit=" + cli.exitCode);

const failed = results.filter((r) => !r.pass);
console.log("metafile:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
