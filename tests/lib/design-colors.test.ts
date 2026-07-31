// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/runtime/color
// @see https://bun.com/docs/pm/cli/update#visual-indicators
import { describe, expect, test } from "bun:test";
import {
  COLORS,
  ansi,
  ansi16m,
  channels,
  convert,
  paintSemverChange,
  semverChangeColor,
} from "../../src/lib/design-colors.ts";

describe("design-colors · Bun.color", () => {
  test("hex converts to css / number / channels", () => {
    const hex = convert("trading", "HEX");
    expect(typeof hex === "string" || typeof hex === "number").toBe(true);
    expect(typeof convert("trading", "number")).toBe("number");
    const rgb = channels("trading");
    expect(rgb.r).toBeGreaterThan(0);
  });

  test("ansi helpers return escape or empty (NO_COLOR)", () => {
    expect(typeof ansi("tennis")).toBe("string");
    expect(typeof ansi16m("tennis")).toBe("string");
  });

  test("semver visual indicators match bun update language", () => {
    // @see https://bun.com/docs/pm/cli/update#visual-indicators
    expect(semverChangeColor("major")).toBe("semverMajor");
    expect(semverChangeColor("minor")).toBe("semverMinor");
    expect(semverChangeColor("patch")).toBe("semverPatch");
    expect(COLORS.semverMajor).toMatch(/^#/i);
    const painted = paintSemverChange("patch", "1.2.3 → 1.2.4");
    expect(painted).toContain("1.2.3 → 1.2.4");
  });
});
