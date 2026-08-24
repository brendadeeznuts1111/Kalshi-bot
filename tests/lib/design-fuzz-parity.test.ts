// Fuzz parity: the browser fallback must match Bun.color byte-for-byte for
// the six cached formats across many random hex colors (not just the 15-key
// palette) — the strongest guard against silent divergence.
// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { convertColorFallback } from "../../src/lib/color/index.ts";

describe("convertColorFallback fuzz parity (Bun.color oracle)", () => {
  const FORMATS = ["css", "HEX", "number", "{rgb}", "{rgba}", "ansi-16m"] as const;
  const rand = (n: number): number => Math.floor(Math.random() * n);

  test("200 random hex colors match Bun.color for all cached formats", () => {
    for (let i = 0; i < 200; i += 1) {
      const hex = "#" + [0, 1, 2].map(() => rand(256).toString(16).padStart(2, "0")).join("");
      for (const format of FORMATS) {
        const bun = Bun.color(hex, format as "hex");
        const fb = convertColorFallback(hex, format);
        expect(fb, hex + " " + format).toEqual(bun);
      }
    }
  });

  test("random tints round-trip through Bun as the oracle", () => {
    for (let i = 0; i < 50; i += 1) {
      const hex = "#" + [0, 1, 2].map(() => rand(256).toString(16).padStart(2, "0")).join("");
      const out = convertColorFallback(hex, "{rgba}") as { r: number; g: number; b: number };
      expect(out.r, hex).toBeGreaterThanOrEqual(0);
      expect(out.r, hex).toBeLessThanOrEqual(255);
    }
  });
});
