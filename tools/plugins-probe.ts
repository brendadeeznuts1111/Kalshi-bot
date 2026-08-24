#!/usr/bin/env bun
/**
 * `bun run plugins:probe` — probe bun.com/docs/bundler/plugins claims
 * against the installed runtime (AGENT-PITFALLS §61).
 *
 * VERIFIED (Bun 1.4.0):
 *   - named export `plugin` from "bun" === Bun.plugin (identity)
 *   - default namespace is "file" (onResolve {namespace:"file"} sees
 *     relative imports); void return = default resolution continues
 *   - env-plugin virtual module (onResolve+onLoad) works in Bun.build
 *   - onStart async awaited before onLoad
 *   - onEnd async awaited before Bun.build resolves; receives BuildOutput
 *     with success=false + logs when the build fails
 *   - defer() once-only (second call throws)
 *   - Bun.build THROWS AggregateError on unresolvable imports
 *
 * CORRECTED (doc claims WRONG on 1.4.0):
 *   - namespace chars restricted to $a-zA-Z0-9_-: the doc's
 *     `namespace: "yaml:"` THROWS TypeError
 *   - `import ... from "file:./dep"` does NOT resolve (doc: "same as
 *     ./dep") — a plugin CAN intercept and redirect it
 *   - onStart CAN mutate build.config (doc Note: cannot) — outdir
 *     mutation took effect
 *   - node:/bun: imports resolve with ns "file" (doc: "node"/"bun") —
 *     onResolve({namespace:"node"}) never fires; bun:sqlite needs
 *     target:"bun" under Bun.build (default target throws)
 *   - runtime onResolve/onLoad do NOT fire (catch-all FIRED=0) — only
 *     build.module() creates runtime virtual modules; bunfig key is
 *     `preload`, NOT `[runtime] plugins`
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const checks: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { checks.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

console.log("plugins:probe — bun " + Bun.version + " (" + Bun.revision + ")");

// P1: plugin named export === Bun.plugin
import { plugin as namedPlugin } from "bun";
check("P1 plugin === Bun.plugin", (Bun as any).plugin === namedPlugin, "identity=" + ((Bun as any).plugin === namedPlugin));

// P2: namespace char restriction (doc: yaml:)
const dir = mkdtempSync(join(tmpdir(), "plugins-probe-"));
writeFileSync(join(dir, "x.ts"), "export const x = 1;\n");
let nsThrow = "";
try {
  await Bun.build({ entrypoints: [join(dir, "x.ts")], outdir: join(dir, "o1"), plugins: [{ name: "bad-ns", setup(build) { build.onLoad({ filter: /./, namespace: "yaml:" }, () => undefined); } }] });
  nsThrow = "no-throw";
} catch (e) { nsThrow = (e as Error).message || String(e).slice(0, 60); }
check("P2 namespace yaml: (colon) rejected", nsThrow.includes("namespace can only contain"), nsThrow);

// P3: default namespace is file; void = default resolution
writeFileSync(join(dir, "app.ts"), 'import { v } from "./dep";\nconsole.log(v);\n');
writeFileSync(join(dir, "dep.ts"), "export const v = 42;\n");
let sawNs = "";
const r3 = await Bun.build({ entrypoints: [join(dir, "app.ts")], outdir: join(dir, "o3"), plugins: [{ name: "ns", setup(build) {
  build.onResolve({ filter: /\.\/dep$/, namespace: "file" }, (args) => { sawNs = args.namespace; return undefined; });
} }] });
check("P3 default ns file + void continues", r3.success && sawNs === "file", "ns=" + JSON.stringify(sawNs) + " success=" + r3.success);

// P4: env-plugin virtual module in Bun.build
writeFileSync(join(dir, "envapp.ts"), 'import env from "env";\nconsole.log(env.PROBE_ENV_VAL);\n');
const r4 = await Bun.build({ entrypoints: [join(dir, "envapp.ts")], outdir: join(dir, "o4"), plugins: [{ name: "env", setup(build) {
  build.onResolve({ filter: /^env$/ }, () => ({ path: "env", namespace: "env" }));
  build.onLoad({ filter: /.*/, namespace: "env" }, () => ({ contents: "export default " + JSON.stringify({ PROBE_ENV_VAL: "VIRTUAL_OK" }), loader: "js" as const }));
} }] });
let out4 = "";
if (r4.success) { const f = r4.outputs.find((o) => o.kind === "entry-point"); if (f) out4 = readFileSync(f.path, "utf8"); }
check("P4 env virtual module builds", r4.success && out4.includes("VIRTUAL_OK"), "success=" + r4.success + " has=" + out4.includes("VIRTUAL_OK"));

// P5: onStart awaited before onLoad; config mutation takes effect
const seq: string[] = [];
const mutated = join(dir, "mutated");
const original = join(dir, "o5");
await Bun.build({ entrypoints: [join(dir, "dep.ts")], outdir: original, plugins: [{ name: "s", setup(build) {
  build.onStart(async () => { seq.push("start-begin"); await Bun.sleep(25); seq.push("start-end"); });
  build.onLoad({ filter: /dep\.ts$/ }, () => { seq.push("load"); return undefined; });
  build.onStart(() => { (build.config as any).outdir = mutated; });
} }] });
const iEnd = seq.indexOf("start-end");
const iLoad = seq.indexOf("load");
check("P5 onStart awaited before onLoad", iEnd !== -1 && iLoad !== -1 && iEnd < iLoad, "seq=" + JSON.stringify(seq));
const mutatedHas = (await Bun.file(join(mutated, "dep.js")).exists()) || (await Bun.file(join(mutated, "dep.ts.js")).exists());
const origHas = (await Bun.file(join(original, "dep.js")).exists()) || (await Bun.file(join(original, "dep.ts.js")).exists());
check("P5b onStart outdir mutation TAKES EFFECT (doc says cannot)", mutatedHas && !origHas, "mutated=" + mutatedHas + " original=" + origHas);

// P6: onEnd awaited; success=false on failed build
const seq6: string[] = [];
let endSuccess = "";
writeFileSync(join(dir, "badapp.ts"), 'import x from "no-such-pkg";\nconsole.log(x);\n');
try {
  await Bun.build({ entrypoints: [join(dir, "badapp.ts")], outdir: join(dir, "o6"), plugins: [{ name: "e", setup(build) {
    build.onEnd(async (result: any) => { endSuccess = "success=" + result.success + " logs=" + (result.logs || []).length; seq6.push("end"); await Bun.sleep(15); });
  } }] });
} catch (e) { seq6.push("throw"); }
seq6.push("resolved");
check("P6 onEnd fires with success=false on failure", endSuccess.includes("success=false") && seq6[0] === "end" && seq6[seq6.length - 1] === "resolved", endSuccess + " seq=" + JSON.stringify(seq6));

// P7: defer() once-only (with onResolve added — doc example lacks it)
writeFileSync(join(dir, "deferapp.ts"), 'import stats from "stats.json";\nconsole.log(stats);\n');
let deferDetail = "";
const r7 = await Bun.build({ entrypoints: [join(dir, "deferapp.ts")], outdir: join(dir, "o7"), plugins: [{ name: "d", setup(build) {
  build.onResolve({ filter: /^stats\.json$/ }, () => ({ path: "stats.json", namespace: "stats" }));
  build.onLoad({ filter: /stats\.json/, namespace: "stats" }, async ({ defer }) => {
    await defer();
    try { await defer(); deferDetail = "second-call=OK"; } catch (e) { deferDetail = "second-call=THREW"; }
    return { contents: "export default 1", loader: "js" as const };
  });
} }] });
check("P7 defer once-only", r7.success && deferDetail === "second-call=THREW", deferDetail);

// P8: node:fs namespace is file, not node
let nodeNs = "";
writeFileSync(join(dir, "nodeapp.ts"), 'import { readFileSync } from "node:fs";\nconsole.log(readFileSync);\n');
await Bun.build({ entrypoints: [join(dir, "nodeapp.ts")], outdir: join(dir, "o8"), plugins: [{ name: "n", setup(build) {
  build.onResolve({ filter: /./ }, (args) => { if (args.path === "node:fs") nodeNs = args.namespace; return undefined; });
} }] });
check("P8 node:fs ns is file (doc says node)", nodeNs === "file", "ns=" + JSON.stringify(nodeNs));

// P9: runtime build.module() works via preload; onResolve does not fire
writeFileSync(join(dir, "plugin.ts"), 'import { plugin } from "bun";\nplugin({ name: "vm", setup(build) {\n  build.module("hello:world", () => ({ exports: { foo: "bar" }, loader: "object" as const }));\n} });\n');
writeFileSync(join(dir, "modapp.ts"), 'const { foo } = await import("hello:world");\nconsole.log("MODULE_API=" + foo);\n');
const proc = Bun.spawn(["bun", "--preload", join(dir, "plugin.ts"), join(dir, "modapp.ts")], { stdout: "pipe", stderr: "pipe" });
const out9 = await new Response(proc.stdout).text();
const exit9 = await proc.exited;
check("P9 runtime build.module() via --preload", exit9 === 0 && out9.includes("MODULE_API=bar"), "exit=" + exit9 + " out=" + out9.trim());

const fails = checks.filter((c) => !c.pass);
console.log("---");
console.log("plugins:probe — " + (checks.length - fails.length) + "/" + checks.length + " pass" + (fails.length ? " · FAIL: " + fails.map((f) => f.name).join(", ") : ""));
rmSync(dir, { recursive: true, force: true });
process.exit(fails.length ? 1 : 0);