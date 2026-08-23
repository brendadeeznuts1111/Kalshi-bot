// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { formatLine, formatLineColor, inspectColor, inspectValue } from "../../src/institutions/terminal-utils.ts";

describe("inspectValue / inspectColor", () => {
  test("inspectValue plain serializes like console.log", () => {
    expect(inspectValue({ foo: "bar" }, { colors: false })).toContain("foo");
    expect(inspectValue({ foo: "bar" }, { colors: false })).not.toContain("\u001b[");
  });

  test("inspectColor forces ANSI even in non-color contexts", () => {
    const out = inspectColor({ foo: "bar" });
    expect(out).toContain("\u001b[");
  });

  test("typed arrays serialize with their type tag", () => {
    expect(inspectValue(new Uint8Array([1, 2, 3]), { colors: false })).toContain("Uint8Array");
  });

  test("depth truncates with [Object ...]", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    expect(inspectValue(deep, { depth: 2 })).toContain("[Object ...]");
    expect(inspectValue(deep, { depth: 10 })).not.toContain("[Object ...]");
  });
describe("formatLine", () => {
  test("%s/%d/%o specifiers render", () => {
    expect(formatLine("%s: %d items, %o", "Store", 42, { a: 1 })).toContain("Store: 42 items");
    expect(formatLine("plain %s", "x")).not.toContain("\u001b[");
  });

  test("formatLineColor forces ANSI", () => {
    expect(formatLineColor("%o", { a: 1 })).toContain("\u001b[");
  });
});

describe("inspectValue sorted", () => {
  test("sorted: true orders keys", () => {
    const out = inspectValue({ z: 1, a: 2 }, { sorted: true });
    expect(out.indexOf("a:")).toBeLessThan(out.indexOf("z:"));
  });
});

});