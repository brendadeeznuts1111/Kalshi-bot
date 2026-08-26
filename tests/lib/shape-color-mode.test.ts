// Proper definitions for the S211 corrections: resolveColorMode (env-driven ANSI depth) +
// isBunFile guard + shapeMatch wildcard matcher.
import { describe, expect, test } from "bun:test";
import { resolveColorMode } from "../../src/lib/color/theme.ts";
import { isBunFile, shapeMatch } from "../../src/lib/shape.ts";

describe("resolveColorMode (S211)", () => {
  test("NO_COLOR wins over everything", () => {
    expect(resolveColorMode({ NO_COLOR: "1" })).toBe("none");
    expect(resolveColorMode({ NO_COLOR: "1", FORCE_COLOR: "3" })).toBe("none");
    expect(resolveColorMode({ NO_COLOR: "0" }, { isTty: true })).toBe("16m");
  });

  test("FORCE_COLOR 1|2|3 -> 16 / 256 / 16m; 0 -> none", () => {
    expect(resolveColorMode({ FORCE_COLOR: "1" })).toBe("16");
    expect(resolveColorMode({ FORCE_COLOR: "2" })).toBe("256");
    expect(resolveColorMode({ FORCE_COLOR: "3" })).toBe("16m");
    expect(resolveColorMode({ FORCE_COLOR: "0" })).toBe("none");
  });

  test("TTY -> 16m default; piped -> none", () => {
    expect(resolveColorMode({}, { isTty: true })).toBe("16m");
    expect(resolveColorMode({}, { isTty: false })).toBe("none");
  });
});

describe("isBunFile (S211)", () => {
  test("Bun.file result is a BunFile (Blob + name/path); plain Blob is not", () => {
    const f = Bun.file("./package.json");
    expect(isBunFile(f)).toBe(true);
    expect(isBunFile(new Blob(["x"]))).toBe(false);
    expect(isBunFile("string")).toBe(false);
    expect(isBunFile(null)).toBe(false);
  });
});

describe("shapeMatch (S211 proper wildcard matcher)", () => {
  test("exact primitives + deepEquals semantics", () => {
    expect(shapeMatch({ a: 1 }, { a: 1 })).toBe(true);
    expect(shapeMatch({ a: 1 }, { a: 2 })).toBe(false);
    expect(shapeMatch({ a: "1" }, { a: 1 })).toBe(false);
  });

  test("* wildcard matches any value", () => {
    expect(shapeMatch({ a: { anything: [1, 2] } }, { a: "*" })).toBe(true);
    expect(shapeMatch({ root: { "@id": "a" } }, { root: { "@id": "*" } })).toBe(true);
  });

  test("extra actual keys allowed (schema is a subset) - unlike Bun.deepMatch", () => {
    expect(shapeMatch({ a: 1, b: 2, c: 3 }, { a: 1, b: 2 })).toBe(true);
    expect(shapeMatch({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test("nested objects recurse; missing keys fail", () => {
    expect(shapeMatch({ a: { b: { c: 1 } } }, { a: { b: {} } })).toBe(true);
    expect(shapeMatch({ a: { x: 1 } }, { a: { b: 1 } })).toBe(false);
  });

  test("arrays: single-item schema checks every element", () => {
    expect(shapeMatch({ a: [1, 2, 3] }, { a: ["*"] })).toBe(true);
    expect(shapeMatch({ a: [1, 2, 3] }, { a: [1] })).toBe(false); // element 2 != 1
    expect(shapeMatch({ a: [] }, { a: [] })).toBe(true);
  });
});
