// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { checkFileBrowserSafety } from "../../src/lib/design-browser-safety.ts";

const KERNEL = "/src/lib/color/kernel.ts";

describe("checkFileBrowserSafety", () => {
  test("guarded kernel passes (the only legit Bun call)", () => {
    const src = [
      'const HAS_BUN_COLOR = typeof Bun !== "undefined" && typeof Bun.color === "function";',
      "function colorConvert(value: string, format: string) {",
      "  if (HAS_BUN_COLOR) {",
      '    return Bun.color(value, format as "hex");',
      "  }",
      "  return convertColorFallback(value, format);",
      "}",
    ].join("\n");
    expect(checkFileBrowserSafety(KERNEL, src)).toEqual([]);
  });

  test("flags Bun.color outside the guard", () => {
    const src = [
      "const HAS_BUN_COLOR = typeof Bun !== 'undefined';",
      "function colorConvert(value: string, format: string) {",
      "  if (HAS_BUN_COLOR) {",
      '    return Bun.color(value, format as "hex");',
      "  }",
      "  return convertColorFallback(value, format);",
      "}",
      "export function ansi(key: string) {",
      '  return Bun.color(key, "ansi");', // unguarded
      "}",
    ].join("\n");
    const v = checkFileBrowserSafety(KERNEL, src);
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toContain("unguarded");
  });

  test("unparseable file is reported by the parse oracle (§47)", () => {
    const bad = "function f(value: string { return; }";
    const v = checkFileBrowserSafety("/src/lib/x.ts", bad);
    expect(v).toHaveLength(1);
    expect(v[0]!.detail).toContain("does not parse");
  });

  test("flags Bun references in non-kernel graph files", () => {
    const src = 'export const x = Bun.color("#fff", "css");';
    expect(checkFileBrowserSafety("/src/research/hq-app/app.js", src)).toHaveLength(1);
  });

  test("exempts typeof Bun guards and Bun in comments/strings", () => {
    const src = [
      'const HAS = typeof Bun !== "undefined";', // exempt
      '// Bun.color is Bun-native (comment)',
      'const msg = "Bun.color is only for servers";', // string literal
      "export const ok = 1;",
    ].join("\n");
    expect(checkFileBrowserSafety("/src/lib/color/roles.ts", src)).toEqual([]);
  });

  test("kernel without a guard fails loudly", () => {
    const src = 'export const x = Bun.color("#fff", "css");';
    const v = checkFileBrowserSafety(KERNEL, src);
    expect(v[0]!.detail).toContain("no HAS_BUN_COLOR guard");
  });
});
