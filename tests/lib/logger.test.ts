import { describe, expect, test } from "bun:test";
import { stripANSI } from "bun";
import { formatValue, log, terminalColumns } from "../../src/lib/logger.ts";

/** Visible-width assertions immune to accidental ANSI in the test runner. */
function plain(s: string): string {
  return stripANSI(s);
}

describe("src/lib/logger", () => {
  test("terminalColumns returns a sane width even when piped", () => {
    // Test runner stdout is piped -> columns is undefined -> 80 fallback.
    expect(terminalColumns()).toBeGreaterThanOrEqual(80);
  });

  test("formatValue truncates a long line to the width budget including the ellipsis", () => {
    const out = formatValue("a".repeat(200), { columns: 20, ellipsis: "…" });
    expect(plain(out).endsWith("…")).toBe(true);
    expect(plain(out).length).toBeLessThanOrEqual(20);
  });

  test("formatValue respects the depth option", () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    const out = formatValue(deep, { depth: 1, columns: 0 });
    expect(out).toContain("Object");
    expect(out).not.toContain("d: 1");
  });

  test("formatValue truncates every line of multi-line output", () => {
    const out = formatValue({ key: "x".repeat(300) }, { columns: 24 });
    for (const line of out.split("\n")) {
      expect(plain(line).length).toBeLessThanOrEqual(24);
    }
  });

  test("log() re-truncates the joined multi-arg line to the width", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (s: string) => lines.push(String(s));
    try {
      log("x".repeat(200), "y".repeat(200)); // 2 x 80-wide values joined must not overflow
    } finally {
      console.log = orig;
    }
    for (const line of lines) {
      expect(plain(line).length).toBeLessThanOrEqual(80);
    }
  });

  test("custom inspect symbol is honored", () => {
    class Marker {
      [Symbol.for("nodejs.util.inspect.custom")]() {
        return "MARKED";
      }
    }
    expect(formatValue(new Marker(), { columns: 0 })).toBe("MARKED");
  });

  test("log handles odd values without throwing", () => {
    expect(() => log(1, "two", { three: 3 }, null, undefined, Symbol("s"))).not.toThrow();
  });
});
