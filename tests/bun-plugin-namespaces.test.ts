// @see https://bun.com/docs/bundler/plugins#namespaces
// (cached locally: research/cache/bun-docs/bundler-plugins.md)
/**
 * Probe for the bundler-plugin "Namespaces" section claims (all offline):
 *  1. default namespace is "file" — a relative import matches an onResolve
 *     scoped to namespace: "file".
 *  2. onResolve can move a module into a custom namespace; onLoad then fires
 *     for that namespace and receives it as args.namespace (the doc's "env"
 *     virtual-module example, verbatim).
 *  3. CORRECTED: namespaces are restricted to [a-zA-Z0-9_-] on Bun 1.4.0 —
 *     the doc's literal namespace: "yaml:" example THROWS at build time
 *     ("namespace can only contain ..."); an alphanumeric namespace works
 *     with the identical filter/onLoad pattern.
 *  4. "node:" and "bun:" namespaces resolve as built-ins (externalized).
 * Note: in-memory output text on 1.4.0 is read via await output.arrayBuffer()
 * (the documented .text accessor is a native fn returning undefined here).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BunPlugin } from "bun";

type BuildTarget = "browser" | "bun" | "node";
type OnLoadArgs = { path: string; namespace: string; loader: string };
type BuildResult = Awaited<ReturnType<typeof Bun.build>>;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "bun-ns-"));
}

async function buildWith(
  entrySource: string,
  setup: (build: any) => void,
  target: BuildTarget = "browser",
): Promise<BuildResult> {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "index.ts"), entrySource);
    writeFileSync(join(dir, "mod.ts"), "export const mod = 1;\n");
    writeFileSync(join(dir, "data.yaml"), "value: 1\n");
    const plugin: BunPlugin = { name: "ns-probe", setup };
    return await Bun.build({
      entrypoints: [join(dir, "index.ts")],
      plugins: [plugin],
      target,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function bundleText(r: BuildResult): Promise<string> {
  const out = r.outputs[0];
  if (!out) return "";
  return new TextDecoder().decode(await out.arrayBuffer());
}

describe("bundler plugin namespaces (docs/bundler/plugins.md §Namespaces)", () => {
  test('default namespace is "file": onResolve scoped to file fires for a relative import', async () => {
    const seen: string[] = [];
    const r = await buildWith(
      `import { mod } from "./mod.ts"; console.log(mod);`,
      (build) => {
        build.onResolve({ filter: /\.\/mod\.ts$/, namespace: "file" }, (args: any) => {
          seen.push(args.path);
        });
      },
    );
    expect(r.success).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]!).toContain("mod.ts");
  });

  test("onResolve moves a module into a custom namespace; onLoad fires with it (env example)", async () => {
    const loaded: OnLoadArgs[] = [];
    const r = await buildWith(
      `import env from "env"; console.log(env.FOO);`,
      (build) => {
        build.onResolve({ filter: /^env$/ }, () => ({ path: "env", namespace: "env" }));
        build.onLoad({ filter: /.*/, namespace: "env" }, (args: any) => {
          loaded.push({ path: args.path, namespace: args.namespace, loader: args.loader });
          return { contents: `export default { FOO: "bar" };`, loader: "js" };
        });
      },
    );
    expect(r.success).toBe(true);
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.path).toBe("env");
    expect(loaded[0]!.namespace).toBe("env");
    expect(typeof loaded[0]!.loader).toBe("string");
    expect(await bundleText(r)).toContain("bar");
  });

  test("namespace charset: 'yaml' works; the doc's 'yaml:' example throws on 1.4.0", async () => {
    // Valid: an alphanumeric namespace loads the virtual module (same pattern
    // as the doc's example, minus the colon).
    const namespaces: string[] = [];
    const r = await buildWith(
      `import data from "./data.yaml"; console.log(data);`,
      (build) => {
        build.onResolve({ filter: /\.yaml$/, namespace: "file" }, () => ({
          path: "data.yaml",
          namespace: "yaml",
        }));
        build.onLoad({ filter: /.*/, namespace: "yaml" }, (args: any) => {
          namespaces.push(args.namespace);
          return { contents: `export default 42;`, loader: "js" };
        });
      },
    );
    expect(r.success).toBe(true);
    expect(namespaces).toEqual(["yaml"]);
    expect(await bundleText(r)).toContain("42");

    // Invalid: the doc's literal "yaml:" namespace is rejected at build time.
    const r2 = buildWith(
      `import data from "./data.yaml"; console.log(data);`,
      (build) => {
        build.onResolve({ filter: /\.yaml$/, namespace: "file" }, () => ({
          path: "data.yaml",
          namespace: "yaml:",
        }));
        build.onLoad({ filter: /.*/, namespace: "yaml:" }, () => ({
          contents: `export default 42;`,
          loader: "js",
        }));
      },
    );
    await expect(r2).rejects.toThrow(/namespace can only contain/);
  });

  test("node: and bun: namespaces resolve as built-ins", async () => {
    const r1 = await buildWith(
      `import { join } from "node:path"; console.log(join("a", "b"));`,
      () => {},
      "node",
    );
    expect(r1.success).toBe(true);

    const r2 = await buildWith(
      `import { Database } from "bun:sqlite"; console.log(typeof Database);`,
      () => {},
      "bun",
    );
    expect(r2.success).toBe(true);
  });
});
