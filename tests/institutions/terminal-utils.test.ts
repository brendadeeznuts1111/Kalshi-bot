// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { inspectColor, inspectValue } from "../../src/institutions/terminal-utils.ts";

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
});
