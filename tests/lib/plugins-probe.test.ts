// Plugins probe tests (§61) — lock the runtime-verified surface so the
// probe conclusions can't silently drift on future Bun upgrades.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PLUGIN_NAMESPACE, asPluginNamespace, INVALID_PLUGIN_NAMESPACES, KNOWN_PLUGIN_NAMESPACES, tryPluginNamespace } from "../../src/lib/plugin-namespaces.ts";

describe("bundler plugins namespaces (§61)", () => {
  test("namespace chars are restricted — yaml: (colon) throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plug-ns-"));
    writeFileSync(join(dir, "x.ts"), "export const x = 1;\n");
    let msg = "";
    try {
      await Bun.build({ entrypoints: [join(dir, "x.ts")], outdir: join(dir, "o"), plugins: [{ name: "bad-ns", setup(build) { build.onLoad({ filter: /./, namespace: "yaml:" }, () => undefined); } }] });
      msg = "no-throw";
    } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("namespace can only contain");
    rmSync(dir, { recursive: true, force: true });
  });

  test("default namespace is file; void onResolve keeps default resolution", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plug-ns2-"));
    writeFileSync(join(dir, "app.ts"), 'import { v } from "./dep";\nconsole.log(v);\n');
    writeFileSync(join(dir, "dep.ts"), "export const v = 42;\n");
    let sawNs = "";
    const r = await Bun.build({ entrypoints: [join(dir, "app.ts")], outdir: join(dir, "o"), plugins: [{ name: "ns", setup(build) {
      build.onResolve({ filter: /\.\/dep$/, namespace: "file" }, (args) => { sawNs = args.namespace; return undefined; });
    } }] });
    expect(r.success).toBe(true);
    expect(sawNs).toBe("file");
    rmSync(dir, { recursive: true, force: true });
  });

  test("node:fs resolves with ns file, not node (doc correction)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plug-ns3-"));
    writeFileSync(join(dir, "app.ts"), 'import { readFileSync } from "node:fs";\nconsole.log(readFileSync);\n');
    let nodeNs = "";
    await Bun.build({ entrypoints: [join(dir, "app.ts")], outdir: join(dir, "o"), plugins: [{ name: "n", setup(build) {
      build.onResolve({ filter: /./ }, (args) => { if (args.path === "node:fs") nodeNs = args.namespace; return undefined; });
    } }] });
    expect(nodeNs).toBe("file");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("bundler plugins hooks (§61)", () => {
  test("env-plugin virtual module pattern works in Bun.build", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plug-env-"));
    writeFileSync(join(dir, "app.ts"), 'import env from "env";\nconsole.log(env.K);\n');
    const r = await Bun.build({ entrypoints: [join(dir, "app.ts")], outdir: join(dir, "o"), plugins: [{ name: "env", setup(build) {
      build.onResolve({ filter: /^env$/ }, () => ({ path: "env", namespace: "env" }));
      build.onLoad({ filter: /.*/, namespace: "env" }, () => ({ contents: "export default " + JSON.stringify({ K: "OK" }), loader: "js" as const }));
    } }] });
    expect(r.success).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("defer() is once-only (second call throws)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plug-def-"));
    writeFileSync(join(dir, "app.ts"), 'import s from "stats.json";\nconsole.log(s);\n');
    let detail = "";
    const r = await Bun.build({ entrypoints: [join(dir, "app.ts")], outdir: join(dir, "o"), plugins: [{ name: "d", setup(build) {
      build.onResolve({ filter: /^stats\.json$/ }, () => ({ path: "stats.json", namespace: "stats" }));
      build.onLoad({ filter: /stats\.json/, namespace: "stats" }, async ({ defer }) => {
        await defer();
        try { await defer(); detail = "second=OK"; } catch { detail = "second=THREW"; }
        return { contents: "export default 1", loader: "js" as const };
      });
    } }] });
    expect(r.success).toBe(true);
    expect(detail).toBe("second=THREW");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("bundler plugins runtime (§61)", () => {
  test("onStart config mutation TAKES EFFECT (doc says cannot)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plug-start-"));
    writeFileSync(join(dir, "dep.ts"), "export const v = 1;\n");
    const mutated = join(dir, "mutated");
    await Bun.build({ entrypoints: [join(dir, "dep.ts")], outdir: join(dir, "o"), plugins: [{ name: "s", setup(build) {
      build.onStart(() => { (build.config as any).outdir = mutated; });
    } }] });
    const mutatedHas = (await Bun.file(join(mutated, "dep.js")).exists()) || (await Bun.file(join(mutated, "dep.ts.js")).exists());
    expect(mutatedHas).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("runtime virtual module needs build.module() — onResolve alone never fires", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plug-rt-"));
    const app = [
      'import { plugin } from "bun";',
      "let fired = 0;",
      'plugin({ name: "rt", setup(build) {',
      '  build.onResolve({ filter: /./ }, () => { fired++; return undefined; });',
      "} });",
      'import { v } from "./dep";',
      "console.log(\"V=\" + v + \" FIRED=\" + fired);",
    ].join("\n");
    writeFileSync(join(dir, "dep.ts"), "export const v = 7;\n");
    writeFileSync(join(dir, "app.ts"), app);
    const proc = Bun.spawn(["bun", "run", join(dir, "app.ts")], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(out).toContain("FIRED=0");
    rmSync(dir, { recursive: true, force: true });
  });
});


describe("plugin namespace registry (src/lib/plugin-namespaces.ts)", () => {
  test("DEFAULT is file; KNOWN map keys all validate as namespaces", () => {
    expect(String(DEFAULT_PLUGIN_NAMESPACE)).toBe("file");
    for (const key of Object.keys(KNOWN_PLUGIN_NAMESPACES)) {
      expect(String(tryPluginNamespace(key))).toBe(key);
    }
  });

  test("INVALID strings throw via asPluginNamespace (yaml:/file: are doc examples)", () => {
    for (const bad of INVALID_PLUGIN_NAMESPACES) {
      expect(() => asPluginNamespace(bad)).toThrow(/invalid charset/);
    }
  });

  test("UPPER_CASE is VALID (charset includes A-Z — probe §61)", () => {
    expect(String(asPluginNamespace("UPPER_CASE"))).toBe("UPPER_CASE");
  });

  test("node/bun are NOT registered namespaces (probe §61: ns file)", () => {
    expect(Object.keys(KNOWN_PLUGIN_NAMESPACES)).not.toContain("node");
    expect(Object.keys(KNOWN_PLUGIN_NAMESPACES)).not.toContain("bun");
  });

  test("empty string is a special case: registry rejects, runtime accepts (no constraint)", async () => {
    expect(() => asPluginNamespace("")).toThrow(/invalid charset/);
    const dir = mkdtempSync(join(tmpdir(), "plug-empty-"));
    writeFileSync(join(dir, "app.ts"), 'import { v } from "./dep";\nconsole.log(v);\n');
    writeFileSync(join(dir, "dep.ts"), "export const v = 1;\n");
    let fired = 0;
    const r = await Bun.build({ entrypoints: [join(dir, "app.ts")], outdir: join(dir, "o"), plugins: [{ name: "e", setup(build) {
      build.onLoad({ filter: /dep\.ts$/, namespace: "" }, () => { fired++; return undefined; });
    } }] });
    expect(r.success).toBe(true);
    expect(fired).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });
});