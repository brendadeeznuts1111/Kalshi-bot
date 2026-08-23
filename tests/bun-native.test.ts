// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { assertBunAtLeast, deepEqual, escapeHtml, inspectBrief, stableHash } from "../src/research/bun-native.ts";

describe("bun-native", () => {
  test("escapeHtml delegates to Bun.escapeHTML", () => {
    expect(escapeHtml(`a & b < "c" > 'd'`)).toContain("&amp;");
    expect(escapeHtml(`a & b < "c" > 'd'`)).toContain("&lt;");
    expect(escapeHtml(`a & b < "c" > 'd'`)).toContain("&#x27;");
  });

  test("deepEqual matches Bun.deepEquals", () => {
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  test("stableHash is deterministic", () => {
    expect(stableHash("x")).toBe(stableHash("x"));
  });

  test("inspectBrief returns plain string", () => {
    expect(inspectBrief({ ok: true })).toContain("ok");
  });

  test("assertBunAtLeast passes on the running Bun", () => {
    expect(() => assertBunAtLeast("1.4.0")).not.toThrow();
  });

  test("assertBunAtLeast throws for an impossible baseline", () => {
    expect(() => assertBunAtLeast("99.0.0", "future feature")).toThrow(/Bun >= 99.0.0/);
  });

  test("Bun.semver.satisfies gates the baseline", () => {
    expect(Bun.semver.satisfies("1.4.0", ">=1.4.0")).toBe(true);
    expect(Bun.semver.satisfies("1.3.9", ">=1.4.0")).toBe(false);
  });
});
