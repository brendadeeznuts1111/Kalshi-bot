// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { deepEqual, escapeHtml, inspectBrief, stableHash } from "../src/research/bun-native.ts";

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
});
