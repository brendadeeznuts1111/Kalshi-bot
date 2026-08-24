// Import graph via Bun.Transpiler.scan — accuracy + duplicate detection (§53).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("scan accuracy (native parser, not regex)", () => {
  test("ignores fake imports in comments/strings/templates", () => {
    const t = new Bun.Transpiler({ loader: "tsx" });
    const s = t.scan("// import fake from \"a\"\nconst s = \"import x from y\";\nconst q = `import z from \"b\"`;")
    expect(s.imports).toEqual([]);
  });

  test("catches re-exports + dynamic + semicolon-less", () => {
    const t = new Bun.Transpiler({ loader: "tsx" });
    const s = t.scan("export * from \"./all\"\nexport { x } from \"./ree\"\nimport(\"./dyn\")\nimport a from \"./a\"")
    const paths = s.imports.map((i) => i.path);
    expect(paths).toContain("./all");
    expect(paths).toContain("./ree");
    expect(paths).toContain("./dyn");
    expect(paths).toContain("./a");
  });

  test("type-mixed import lists the module (only pure-type ignored)", () => {
    const t = new Bun.Transpiler({ loader: "tsx" });
    const s = t.scan("import { type A, B } from \"./mixed\";");
    expect(s.imports.map((i) => i.path)).toEqual(["./mixed"]);
  });
});

describe("imports:graph duplicate detection", () => {
  test("flags duplicate specifiers in a file", () => {
    const t = new Bun.Transpiler({ loader: "tsx" });
    const src = "import { a } from \"./m\";\nimport { b } from \"./m\";";
    const s = t.scan(src);
    const counts = new Map<string, number>();
    for (const i of s.imports) counts.set(i.path, (counts.get(i.path) ?? 0) + 1);
    expect(counts.get("./m")).toBe(2);
  });
});