// Bun.YAML coverage (YM-parse, YM-stringify, §9) - YAML 1.2 semantics (yes/on/no are strings).
import { describe, expect, test } from "bun:test";

describe("Bun.YAML.parse", () => {
  test("maps objects, arrays, nesting (YM-parse)", () => {
    expect(Bun.YAML.parse("a: 1\nb: [1, 2]")).toEqual({ a: 1, b: [1, 2] });
    expect(Bun.YAML.parse("root:\n  child:\n    - 1\n    - 2")).toEqual({ root: { child: [1, 2] } });
  });

  test("YAML 1.2: yes/on/no are strings, true is boolean", () => {
    expect(Bun.YAML.parse("v: yes")).toEqual({ v: "yes" });
    expect(Bun.YAML.parse("v: on")).toEqual({ v: "on" });
    expect(Bun.YAML.parse("v: true")).toEqual({ v: true });
  });
});

describe("Bun.YAML.stringify", () => {
  test("flow-style output for plain objects (YM-stringify)", () => {
    expect(Bun.YAML.stringify({ a: 1, b: [1, 2] })).toBe("{a: 1,b: [1,2]}");
  });
});