#!/usr/bin/env bun
/**
 * `bun run bun:build-probe` — probe the Bun build-system changelog claims
 * (§109) against the installed runtime: feature() flags, Bun.build files,
 * metafile format, TC39 decorators, --compile --target=browser, --asset
 * embedding, --bytecode ESM. Records VERIFIED / CORRECTED / unprobeable.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const dir = mkdtempSync(join(tmpdir(), "bun-build-probe-"));
const SECRET = "SECRET_STRING_PRESENT";

try {
  // P1: feature() dead-branch removal at build time (features:[] form).
  writeFileSync(join(dir, "entry.ts"), "import { feature } from \"bun:bundle\";\nif (feature(\"SUPER_SECRET\")) { console.log(\"" + SECRET + "\"); }\nconsole.log(\"ALWAYS\");\n");
  const rOff = await Bun.build({ entrypoints: [join(dir, "entry.ts")], outdir: join(dir, "outOff"), naming: "e.js" });
  const rOn = await Bun.build({ entrypoints: [join(dir, "entry.ts")], features: ["SUPER_SECRET"], outdir: join(dir, "outOn"), naming: "e.js" });
  const offText = await Bun.file(join(dir, "outOff", "e.js")).text();
  const onText = await Bun.file(join(dir, "outOn", "e.js")).text();
  check("P1 feature() dead-branch removal (features:[])", rOff.success && rOn.success && !offText.includes(SECRET) && onText.includes(SECRET), "off:" + offText.includes(SECRET) + " on:" + onText.includes(SECRET));

  // P2: positional guard — feature() outside if/ternary throws.
  writeFileSync(join(dir, "guard.ts"), "import { feature } from \"bun:bundle\";\nconsole.log(feature(\"X\"));\n");
  const guard = Bun.spawnSync(["bun", join(dir, "guard.ts")], { stdout: "pipe", stderr: "pipe" });
  const guardErr = (guard.stderr?.toString() ?? "") + (guard.stdout?.toString() ?? "");
  check("P2 feature() positional guard (outside if/ternary throws)", guardErr.includes("can only be used directly in an if statement or ternary"), "doc omits this constraint");

  // P3: feature() in if/ternary at runtime returns false when unflagged.
  writeFileSync(join(dir, "rt.ts"), "import { feature } from \"bun:bundle\";\nif (feature(\"X\")) { console.log(\"ON\"); } else { console.log(\"OFF\"); }\n");
  const rt = Bun.spawnSync(["bun", join(dir, "rt.ts")], { stdout: "pipe", stderr: "pipe" });
  check("P3 feature() if-position runtime false", (rt.stdout?.toString() ?? "").includes("OFF"), "bun run works in if/ternary position only");

  // P4: Bun.build({ files }) in-memory build + virtual precedence over disk.
  writeFileSync(join(dir, "disk.ts"), "export const x = 1;\n");
  const mem = await Bun.build({ entrypoints: ["/app/entry.ts"], files: { "/app/entry.ts": "import { g } from \"./g.ts\"; console.log(\"mem:\" + g(\"W\"));", "/app/g.ts": "export function g(n: string) { return \"H,\" + n; }" }, outdir: join(dir, "outMem"), naming: "mem.js" });
  const memRun = Bun.spawnSync(["bun", join(dir, "outMem", "mem.js")], { stdout: "pipe", stderr: "pipe" });
  const virt = await Bun.build({ entrypoints: [join(dir, "disk.ts")], files: { [join(dir, "disk.ts")]: "export const x = 42;\nconsole.log(\"virtual-won\", x);\n" }, outdir: join(dir, "outVirt"), naming: "v.js" });
  const virtRun = Bun.spawnSync(["bun", join(dir, "outVirt", "v.js")], { stdout: "pipe", stderr: "pipe" });
  check("P4 Bun.build({files}) in-memory + virtual precedence", mem.success && (memRun.stdout?.toString() ?? "").includes("mem:H,W") && virt.success && (virtRun.stdout?.toString() ?? "").includes("virtual-won 42"));

  // P5: metafile:true emits esbuild-format inputs/outputs.
  const meta = await Bun.build({ entrypoints: [join(dir, "entry.ts")], outdir: join(dir, "outMeta"), metafile: true });
  const m = meta.metafile as { inputs?: unknown; outputs?: unknown } | undefined;
  check("P5 metafile esbuild format (inputs/outputs)", m !== undefined && typeof m.inputs === "object" && m.inputs !== null && typeof m.outputs === "object" && m.outputs !== null, "already adopted by design:build");

  // P6: TC39 decorators (experimentalDecorators off).
  writeFileSync(join(dir, "dec.ts"), "function logged(value: any, ctx: any) { if (ctx.kind === \"method\") return function (...a: any[]) { console.log(\"called \" + ctx.name); return value.apply(this, a); }; return value; }\nclass C { @logged greet() { return \"hi\"; } }\nconsole.log(new C().greet());\n");
  const dec = Bun.spawnSync(["bun", join(dir, "dec.ts")], { stdout: "pipe", stderr: "pipe" });
  check("P6 TC39 decorators", (dec.stdout?.toString() ?? "").includes("called greet"));

  // P7: --compile --target=browser -> single HTML with inline JS.
  writeFileSync(join(dir, "idx.html"), "<!doctype html><html><body><script>document.title = \"inline-ok\";</script></body></html>");
  const html = Bun.spawnSync(["bun", "build", join(dir, "idx.html"), "--compile", "--target=browser", "--outdir=" + join(dir, "outHtml")], { stdout: "pipe", stderr: "pipe" });
  const htmlOut = await Bun.file(join(dir, "outHtml", "idx.html")).text().catch(() => "");
  check("P7 --compile --target=browser single-file HTML", (html.exitCode ?? 1) === 0 && htmlOut.includes("inline-ok"));

  // P8: --asset embeds; node:fs sees ORIGINAL paths; /$bunfs/ ABSENT.
  writeFileSync(join(dir, "assets-greeting.txt"), "hello-bunfs");
  writeFileSync(join(dir, "srv.ts"), "import { existsSync, readdirSync } from \"node:fs\";\nconsole.log(\"orig:\" + existsSync(\"/" + dir + "/assets-greeting.txt\"));\nconsole.log(\"dir:\" + readdirSync(\"/" + dir + "\").includes(\"assets-greeting.txt\"));\nconsole.log(\"bunfs:\" + existsSync(\"/$bunfs\"));\n");
  const assetBuild = Bun.spawnSync(["bun", "build", join(dir, "srv.ts"), "--compile", "--asset", dir, "--outfile", join(dir, "srv")], { stdout: "pipe", stderr: "pipe" });
  const srv = Bun.spawnSync([join(dir, "srv")], { stdout: "pipe", stderr: "pipe" });
  const srvOut = (srv.stdout?.toString() ?? "") + (srv.stderr?.toString() ?? "");
  check("P8 --asset embeds at original paths; /$bunfs/ absent", (assetBuild.exitCode ?? 1) === 0 && srvOut.includes("orig:true") && srvOut.includes("dir:true") && srvOut.includes("bunfs:false"), "doc claims /$bunfs/ — CORRECTED: original-path resolution only");

  // P9: --bytecode --format=esm --compile runs top-level await.
  writeFileSync(join(dir, "tla.ts"), "const v = await Promise.resolve(42);\nconsole.log(\"tla:\" + v);\n");
  const bc = Bun.spawnSync(["bun", "build", join(dir, "tla.ts"), "--compile", "--bytecode", "--format=esm", "--outfile", join(dir, "tla")], { stdout: "pipe", stderr: "pipe" });
  const bcRun = Bun.spawnSync([join(dir, "tla")], { stdout: "pipe", stderr: "pipe" });
  check("P9 --bytecode --format=esm --compile TLA", (bc.exitCode ?? 1) === 0 && (bcRun.stdout?.toString() ?? "").includes("tla:42"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass);
console.log("bun:build-probe — " + (results.length - failed.length) + "/" + results.length + " claims verified" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
