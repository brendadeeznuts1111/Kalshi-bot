// @see https://bun.com/docs/test
// @see https://bun.com/docs/runtime/color#flexible-input
import { describe, expect, test } from "bun:test";
import {
  COLORS,
  COLOR_CSS,
  COLOR_ROLES,
  ansiColor,
  cssColor,
  foregroundCss,
  hexColor,
  isColorKey,
  paint,
  resolveColor,
  rgbChannels,
  rgbaChannels,
  tint,
  type ColorKey,
} from "../../src/lib/color/index.ts";
import {
  buildGlossaryApiPayload,
  getGlossaryEntry,
  resolveGlossaryWireColor,
} from "../../src/institutions/glossary.ts";

describe("Color kernel", () => {
  test("all colors convert to css / hex / foreground", () => {
    for (const key of Object.keys(COLORS) as ColorKey[]) {
      expect(cssColor(key)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(hexColor(key)).toMatch(/^#[0-9A-F]{6}$/);
      expect(foregroundCss(key)).toMatch(/^#(000000|ffffff)$/);
      const rgb = rgbChannels(key);
      expect(rgb.r).toBeGreaterThanOrEqual(0);
      expect(rgb.r).toBeLessThanOrEqual(255);
    }
  });

  test("resolveColor returns wire blob", () => {
    const resolved = resolveColor("trading");
    expect(resolved.key).toBe("trading");
    expect(resolved.css).toBe(cssColor("trading"));
    expect(resolved.foregroundCss).toBe(foregroundCss("trading"));
  });

  test("auto ANSI returns string (possibly empty)", () => {
    expect(ansiColor("kalshi")).toBeTypeOf("string");
  });

  test("paint falls back to plain text when ANSI empty", () => {
    const out = paint("hello", "kalshi", "deterministic");
    expect(out.includes("hello")).toBe(true);
    expect(out.endsWith("hello") || out.includes("\x1b[")).toBe(true);
  });

  test("isColorKey guard", () => {
    expect(isColorKey("kalshi")).toBe(true);
    expect(isColorKey("not-a-color")).toBe(false);
  });

  test("COLOR_ROLES map to valid keys", () => {
    for (const category of Object.values(COLOR_ROLES)) {
      for (const key of Object.values(category)) {
        expect(isColorKey(key)).toBe(true);
      }
    }
    expect(COLOR_ROLES.semver.major).toBe("semverMajor");
  });

  test("browser macro COLOR_CSS matches kernel cssColor", () => {
    for (const key of Object.keys(COLOR_CSS) as (keyof typeof COLOR_CSS)[]) {
      expect(COLOR_CSS[key]).toBe(cssColor(key));
    }
  });

  test("rgbaChannels returns r,g,b,a for palette keys (Bun.color {rgba})", () => {
    expect(rgbaChannels("tennis")).toEqual({ r: 39, g: 174, b: 96, a: 1 });
    expect(rgbaChannels("kalshi").a).toBe(1);
  });

  test("tint derives the css rgba() string from any hex", () => {
    expect(tint("#3fb27f", 0.15)).toBe("rgba(63,178,127,.15)");
    expect(tint("#e0a93e", 0.15)).toBe("rgba(224,169,62,.15)");
    expect(tint("#000000", 0.35)).toBe("rgba(0,0,0,.35)");
  });

  test("tint alpha drops the leading zero (css convention)", () => {
    expect(tint("#ffffff", 1)).toBe("rgba(255,255,255,1)");
    expect(tint("#ffffff", 0.5)).toBe("rgba(255,255,255,.5)");
  });

  test("design TOKENS tints are derived via tint() (SSOT base hexes)", async () => {
    const { TOKENS } = await import("../../src/institutions/design-tokens.ts");
    const c = TOKENS.color;
    expect(c.okTint).toBe(tint("#3fb27f", 0.15));
    expect(c.warnTint).toBe(tint("#e0a93e", 0.15));
    expect(c.badTint).toBe(tint("#e05e5e", 0.15));
    expect(c.accTint).toBe(tint("#4da3ff", 0.15));
    expect(c.scrim.soft).toBe(tint("#000000", 0.35));
    expect(c.scrim.strong).toBe(tint("#000000", 0.45));
  });
});

describe("Glossary ↔ color wire", () => {
  test("KPI entries expose resolved color on API concepts", () => {
    const p = buildGlossaryApiPayload();
    expect(p.schemaVersion).toBe(5);
    const warnings = p.concepts.find((c) => c.id === "kpi.rps_warnings");
    expect(warnings?.color).toEqual({
      key: "trading",
      css: cssColor("trading"),
      foregroundCss: foregroundCss("trading"),
    });
  });

  test("entries without color resolve to null", () => {
    const mid = getGlossaryEntry("mid");
    expect(resolveGlossaryWireColor(mid)).toBeNull();
    const row = buildGlossaryApiPayload().concepts.find((c) => c.id === "mid");
    expect(row?.color).toBeNull();
  });

  test("ops.palette exposes url + resolved color", () => {
    const row = buildGlossaryApiPayload().concepts.find((c) => c.id === "ops.palette");
    expect(row?.url).toContain("bun.com/docs/runtime/color");
    expect(row?.color?.key).toBe("env");
  });
});
