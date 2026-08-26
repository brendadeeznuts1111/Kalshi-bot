// @see https://bun.com/docs/test
// @see https://bun.com/docs/runtime/color#flexible-input
import { describe, expect, test } from "bun:test";
import {
  COLORS,
  COLOR_CSS,
  COLOR_ROLES,
  ansiColor,
  convertColorFallback, parseExtendedColor,
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

describe("browser fallback parity (no-Bun bundles)", () => {
  // The design-system bundle ships to browsers where Bun.color does not
  // exist; convertColorFallback must produce byte-identical output to
  // Bun.color for every format the kernel caches at module load.
  const FORMATS = ["css", "HEX", "number", "{rgb}", "{rgba}", "ansi-16m"] as const;
  for (const format of FORMATS) {
    test("fallback matches Bun.color for " + format, () => {
      for (const key of Object.keys(COLORS) as ColorKey[]) {
        const bun = Bun.color(COLORS[key], format as "hex");
        const fallback = convertColorFallback(COLORS[key], format);
        expect(fallback, key + " " + format).toEqual(bun);
      }
    });
  }

  test("fallback normalizes 3-digit and uppercase hex", () => {
    expect(convertColorFallback("#fff", "css")).toBe("#fff"); // css abbreviates (Bun.color parity, 2026-08-26 fix)
    expect(convertColorFallback("#7DD3FC", "HEX")).toBe("#7DD3FC");
  });

  test("fallback tint parity with Bun", () => {
    for (const key of Object.keys(COLORS) as ColorKey[]) {
      expect(tint(COLORS[key], 0.15), key).toBe(tintFallback(COLORS[key], 0.15));
    }
  });
});

describe("browser fallback extended formats (hsl / lab / ansi-256)", () => {
  // These formats involve float math where Bun.color's internal precision
  // differs from a standard implementation, so byte-equality is NOT asserted.
  // Instead, the fallback output must be VALID and round-trip to the same
  // color — Bun.color itself is the oracle. Byte-exact parity holds for the
  // six cached formats above (the ones the design system actually consumes).
  const roundTripFormats = ["hsl", "lab"] as const;

  test("fallback hsl/lab parse back to the source color via Bun.color", () => {
    for (const format of roundTripFormats) {
      for (const key of Object.keys(COLORS) as ColorKey[]) {
        const out = convertColorFallback(COLORS[key], format);
        expect(typeof out, key + " " + format).toBe("string");
        // Bun.color can parse its own hsl/lab strings back to rgb.
        const rgb = Bun.color(out as string, "{rgb}") as { r: number; g: number; b: number } | null;
        expect(rgb, key + " " + format + " unparseable: " + out).not.toBeNull();
        const src = convertColorFallback(COLORS[key], "{rgb}") as { r: number; g: number; b: number };
        expect(Math.abs(rgb!.r - src.r), key + " " + format + " r").toBeLessThanOrEqual(2);
        expect(Math.abs(rgb!.g - src.g), key + " " + format + " g").toBeLessThanOrEqual(2);
        expect(Math.abs(rgb!.b - src.b), key + " " + format + " b").toBeLessThanOrEqual(2);
      }
    }
  });

  test("fallback ansi-256 emits a valid 256-color escape", () => {
    for (const key of Object.keys(COLORS) as ColorKey[]) {
      const out = convertColorFallback(COLORS[key], "ansi-256");
      expect(typeof out).toBe("string");
      const m = /^\x1b\[38;5;(\d+)m$/.exec(out as string);
      expect(m, key).not.toBeNull();
      const idx = Number(m![1]!);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(255);
    }
  });

  test("fallback hsl output shape matches Bun's grammar", () => {
    for (const key of Object.keys(COLORS) as ColorKey[]) {
      const out = convertColorFallback(COLORS[key], "hsl") as string;
      expect(out, key).toMatch(/^hsl\([\d.]+,\s*[\d.]+%,\s*[\d.]+%\)$/);
      const bun = Bun.color(COLORS[key], "hsl" as "hex") as string;
      expect(bun, key).toMatch(/^hsl\(/);
    }
  });
});

/** tint()'s output recomputed through the fallback (alpha formatting shared). */
function tintFallback(hex: string, alpha: number): string {
  const { r, g, b } = (convertColorFallback(hex, "{rgba}") as { r: number; g: number; b: number }) ?? { r: 0, g: 0, b: 0 };
  const a = String(alpha).replace(/^0\./, ".");
  return `rgba(${r},${g},${b},${a})`;
}
describe("kernel formats beyond Bun.color 1.4.0 (lch / oklab / oklch / hsv)", () => {
  test("all four render deterministic shapes for a fixed hex", () => {
    const lch = convertColorFallback("#4da3ff", "lch") as string;
    const oklab = convertColorFallback("#4da3ff", "oklab") as string;
    const oklch = convertColorFallback("#4da3ff", "oklch") as string;
    const hsv = convertColorFallback("#4da3ff", "hsv") as string;
    expect(lch).toMatch(/^lch\([\d.]+% [\d.]+ -?[\d.]+\).*$/);
    expect(oklab).toMatch(/^oklab\([\d.]+ -?[\d.]+ -?[\d.]+\).*$/);
    expect(oklch).toMatch(/^oklch\([\d.]+ [\d.]+ -?[\d.]+\).*$/);
    expect(hsv).toMatch(/^hsv\([\d.]+,\s*[\d.]+%,\s*[\d.]+%\).*$/);
  });

  test("hsv hue equals hsl hue (same geometry)", () => {
    for (const key of Object.keys(COLORS) as ColorKey[]) {
      const hsv = convertColorFallback(COLORS[key], "hsv") as string;
      const hsl = convertColorFallback(COLORS[key], "hsl") as string;
      const hue = (s: string): string => s.slice(s.indexOf("(") + 1, s.indexOf(","));
      expect(hue(hsv), key).toBe(hue(hsl));
    }
  });

  test("lch derives from lab (L matches, C = hypot(a,b))", () => {
    const lab = convertColorFallback("#4da3ff", "lab") as string;
    const lch = convertColorFallback("#4da3ff", "lch") as string;
    const labL = lab.slice(lab.indexOf("(") + 1, lab.indexOf("%"));
    const lchL = lch.slice(lch.indexOf("(") + 1, lch.indexOf("%"));
    expect(Math.abs(Number(lchL) - Number(labL))).toBeLessThan(0.01);
  });

  test("Bun.color 1.4.0 rejects these formats (kernel is the only path)", () => {
    for (const f of ["hsv", "lch", "oklab", "oklch"] as const) {
      expect(() => Bun.color("#4da3ff", f as "hex")).toThrow();
    }
  });
});

describe("parseExtendedColor (kernel inverse parsers — Bun.color can't)", () => {
  test("round-trips every extended output format back to the source hex", () => {
    for (const f of ["hsv", "lch", "lab", "oklab", "oklch"] as const) {
      const out = convertColorFallback("#4da3ff", f) as string;
      expect(parseExtendedColor(out), f).toBe("#4da3ff");
    }
  });

  test("parses the documented input examples (spaces or commas)", () => {
    expect(parseExtendedColor("hsv(200 80% 70%)")).toBe(parseExtendedColor("hsv(200, 80%, 70%)"));
    expect(parseExtendedColor("lab(50% 50 50)")).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseExtendedColor("lch(50% 50 100)")).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseExtendedColor("oklab(0.5 0.1 0.1)")).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseExtendedColor("oklch(0.5 0.2 120)")).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("rejects junk and hex (hex is Bun.color's job)", () => {
    expect(parseExtendedColor("not-a-color")).toBeNull();
    expect(parseExtendedColor("#4da3ff")).toBeNull();
  });
});

// Grounding parity (AGENT-PITFALLS §189): Bun.color 1.4.0 parses lab() and
// lch() INPUTS natively (the official color guide documents "LAB strings like
// lab(50% 50 50)"; lch shares the parser) — kernel must agree with the native
// path. oklab/oklch/hsv/device-cmyk inputs return null from Bun.color, so the
// kernel parser is the only path for those.
describe("Bun.color input-parsing ground truth (1.4.0) vs parseExtendedColor", () => {
  test("lab() and lch() inputs parse natively AND match the kernel parser", () => {
    for (const s of ["lab(50% 50 50)", "lab(64.93824% -3.9721727 -54.248283)", "lch(50% 50 100)", "lch(64.93824% 54.393496 -94.19017)"]) {
      const native = Bun.color(s, "hex");
      expect(native, s).not.toBeNull();
      expect(parseExtendedColor(s), s).toBe(native);
    }
  });

  test("oklab/oklch/hsv/device-cmyk inputs return null from Bun.color (kernel only)", () => {
    expect(Bun.color("oklab(0.5 0.1 0.1)", "hex")).toBeNull();
    expect(Bun.color("oklch(0.5 0.2 120)", "hex")).toBeNull();
    expect(Bun.color("hsv(200 80% 70%)", "hex")).toBeNull();
    expect(Bun.color("device-cmyk(0 0.5 0 0)", "hex")).toBeNull();
    // ...and the kernel parser covers the first three
    expect(parseExtendedColor("oklab(0.5 0.1 0.1)")).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseExtendedColor("oklch(0.5 0.2 120)")).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseExtendedColor("hsv(200 80% 70%)")).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("hwb / color-mix inputs parse natively (Bun.color path, not kernel)", () => {
    expect(parseExtendedColor("hwb(200 10% 20%)")).toBeNull();
    expect(parseExtendedColor("color-mix(in srgb, red 50%, blue)")).toBeNull();
    expect(Bun.color("hwb(200 10% 20%)", "hex")).toBe("#1a90cc");
    expect(Bun.color("color-mix(in srgb, red 50%, blue)", "hex")).toBe("#800080");
  });
});
