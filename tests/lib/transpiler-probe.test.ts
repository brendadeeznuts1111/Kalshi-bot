// Bun.Transpiler probe matrix (§47): transform/scan + Import.kind nuances.
import { describe, expect, test } from "bun:test";

describe("Bun.Transpiler", () => {
  test("transformSync strips types + defines constants", () => {
    const t = new Bun.Transpiler({ define: { "process.env.NODE_ENV": "\"production\"" } });
    expect(t.transformSync("const x: number = 1;", "ts").trim()).toBe("const x = 1;");
    expect(t.transformSync("const e = process.env.NODE_ENV;", "js").trim()).toContain("\"production\"");
  });

  test("scan() returns exports + imports with documented kinds", () => {
    const t = new Bun.Transpiler();
    const src = ["import a from \"a\";", "const c = require(\"c\");", "const r = require.resolve(\"d\");", "const d = import(\"e\");", "export const z = 1;"].join("\n");
    const s = t.scan(src);
    expect(s.exports).toEqual(["z"]);
    const kinds = s.imports.map((i) => i.kind);
    expect(kinds).toContain("import-statement");
    expect(kinds).toContain("require-call");
    expect(kinds).toContain("require-resolve");
    expect(kinds).toContain("dynamic-import");
  });

  test("scanImports() DROPS require-resolve (vs scan().imports)", () => {
    const t = new Bun.Transpiler();
    const src = "const r = require.resolve(\"d\");";
    expect(t.scanImports(src)).toEqual([]); // require-resolve missing
    expect(t.scan(src).imports).toEqual([{ kind: "require-resolve", path: "d" }]);
  });

  test("ctor loader fixes scan() for TS (bare scan defaults to jsx)", () => {
    const bare = new Bun.Transpiler();
    const loaded = new Bun.Transpiler({ loader: "ts" });
    const ts = "export function f(x: number): number { return x; }";
    expect(() => bare.scan(ts)).toThrow();
    expect(loaded.scan(ts).exports).toEqual(["f"]);
  });

  test("ctor loader makes transformSync work without the 2nd arg", () => {
    const t = new Bun.Transpiler({ loader: "ts" });
    expect(t.transformSync("const x: number = 1;").trim()).toBe("const x = 1;");
  });

  test("treeShaking drops unused imports", () => {
    const t = new Bun.Transpiler({ treeShaking: true });
    const out = t.transformSync("import { unused } from \"m\";\nconst a = 1;\nconsole.log(a);", "js");
    expect(out).not.toContain("unused");
  });

  test("replMode wraps object literals (§50)", () => {
    const t = new Bun.Transpiler({ replMode: true });
    const out = t.transformSync("{ a: 1 }", "js");
    expect(out).toContain("__proto__: null");
    expect(out).toContain("value: { a: 1 }");
  });

  test("macro replaces function calls + removes the import (§50)", async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), ".tmp-macro-" + process.pid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "m.ts"), "export function graphql(s: any) { return JSON.stringify({ ran: s }); }");
    const t = new Bun.Transpiler({ macro: { "pkg": { "graphql": join(dir, "m.ts") } } });
    const out = t.transformSync("import { graphql } from \"pkg\";\nconst q = graphql(\"SELECT 1\");", "js");
    rmSync(dir, { recursive: true, force: true });
    expect(out).toContain("SELECT 1");
    expect(out).not.toContain("import { graphql }");
  });

  test("type-only imports/exports are IGNORED with loader:tsx (docs §51)", () => {
    const t = new Bun.Transpiler({ loader: "tsx" });
    const r = t.scan(
      "import React from \"react\";\nimport type { ReactNode } from \"react\";\nexport const name = \"hello\";\nexport type Foo = { a: number };",
    );
    expect(r.exports).toEqual(["name"]); // type export ignored
    expect(r.imports.map((i) => i.path)).toEqual(["react"]); // type import ignored
  });

  test("type-only import throws only on a BARE transpiler (jsx default)", () => {
    const bare = new Bun.Transpiler();
    expect(() => bare.scan("import type { T } from \"m\";")).toThrow();
  });
});