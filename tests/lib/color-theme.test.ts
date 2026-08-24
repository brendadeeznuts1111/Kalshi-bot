// Theme system tests — unified terminal/web/image theme, zero deps.
// @see docs/AGENT-PITFALLS.md §22 (probe corrections for Bun.color claims)
import { describe, expect, test } from "bun:test";
import {
  THEME,
  THEME_ROLES,
  accessibleForeground,
  contrastRatio,
  relativeLuminance,
  themeAnsi,
  themeCssVars,
  themeManifest,
  themeSwatchPng,
  verdict,
} from "../../src/lib/color/theme.ts";
import { tokenValues } from "../../src/institutions/design-tokens.ts";
import { convertColorFallback } from "../../src/lib/color/kernel.ts";

describe("unified color theme", () => {
  test("every role value is a legal token value (one vocabulary)", () => {
    const legal = new Set(tokenValues().map((v) => v.toLowerCase()));
    for (const role of THEME_ROLES) {
      expect(legal.has(THEME[role].toLowerCase()), role + " " + THEME[role]).toBe(true);
    }
  });

  test("css vars block covers every role with token hex", () => {
    const css = themeCssVars();
    for (const role of THEME_ROLES) {
      expect(css).toContain("--" + role + ": " + THEME[role] + ";");
    }
  });

  test("wcag luminance: black ~0, white ~1", () => {
    expect(relativeLuminance("#000000")).toBeLessThan(0.001);
    expect(relativeLuminance("#ffffff")).toBeGreaterThan(0.99);
  });

  test("wcag contrast: black/white = 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });

  test("accessible foreground picks black on light, white on dark", () => {
    expect(accessibleForeground("#ffffff")).toBe("#000000");
    expect(accessibleForeground("#000000")).toBe("#ffffff");
    expect(accessibleForeground(THEME.background)).toBe("#ffffff");
  });

  test("verdict thresholds: AAA >= 7, AA >= 4.5, AA-large >= 3", () => {
    expect(verdict(21)).toBe("AAA");
    expect(verdict(7)).toBe("AAA");
    expect(verdict(4.5)).toBe("AA");
    expect(verdict(3)).toBe("AA-large");
    expect(verdict(2.9)).toBe("fail");
  });

  test("ansi codes: explicit formats emit, auto respects env", () => {
    // Explicit formats always emit a code (NO_COLOR does not silence them).
    const c16m = themeAnsi("primary", "16m");
    expect(c16m).toContain("\x1b[38;2;");
    const c256 = themeAnsi("primary", "256");
    expect(c256).toContain("\x1b[38;5;");
    // auto returns "" when colors are disabled (non-TTY / NO_COLOR).
    expect(themeAnsi("primary", "auto")).toBe("");
  });

  test("ansi-16m matches kernel parity (Bun.color path)", () => {
    const direct = convertColorFallback(THEME.primary, "ansi-16m");
    expect(typeof direct).toBe("string");
    expect(themeAnsi("primary", "16m")).toBe(direct as string);
  });

  test("manifest carries roles, cssVars, contrast with verdicts", () => {
    const m = themeManifest();
    expect(m.roles).toEqual([...THEME_ROLES]);
    expect(m.theme.primary).toBe(THEME.primary);
    expect(m.contrast.length).toBeGreaterThanOrEqual(5);
    for (const c of m.contrast) {
      expect(["AA", "AAA", "AA-large", "fail"]).toContain(c.verdict);
      expect(c.ratio).toBeGreaterThanOrEqual(1);
      expect(c.ratio).toBeLessThanOrEqual(21);
    }
    for (const role of THEME_ROLES) {
      expect(m.ansi[role]).toHaveProperty("auto");
      expect(m.ansi[role]).toHaveProperty("16");
      expect(m.ansi[role]).toHaveProperty("256");
      expect(m.ansi[role]).toHaveProperty("16m");
    }
  });

  test("swatch PNG decodes as a real square image", async () => {
    const png = themeSwatchPng("primary", 32);
    expect(png[0]).toBe(137); // PNG signature
    expect(png[1]).toBe(80);
    const img = new Bun.Image(png);
    const meta = await img.metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(32);
    expect(meta.format).toBe("png");
  });
});
