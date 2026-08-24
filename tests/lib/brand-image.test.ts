// @see https://bun.com/docs/test/index#run-tests
// Bun.image (1.4.0, file-based) + brand artifacts: the brand card is a
// token-compliant enforced surface; the swatch PNGs must decode back via
// Bun.image with the expected dimensions/format.
import { describe, expect, test } from "bun:test";
import { designAgent } from "../../src/agent/design-agent.ts";
import { BRAND, DESIGN_SYSTEM_VERSION, TOKENS } from "../../src/institutions/design-tokens.ts";
import {
  brandBadgeSvg,
  brandCardPng,
  brandCardSvg,
  hasWebView,
  brandChartSvg,
  brandQuoteSvg,
  brandSwatchPng,
  clampDim,
  convertImageFile,
  decodeImage,
  imageResponse,
  readImageMeta,
  tokenRgb,
  transformImage,
  validateFontUrl,
} from "../../src/lib/brand-image.ts";

describe("brand card (branding artifact)", () => {
  test("SVG is token-compliant (one vocabulary)", () => {
    const a = designAgent.audit(brandCardSvg());
    expect(a.issues).toEqual([]);
  });

  test("SVG carries wordmark, tagline and version", () => {
    const svg = brandCardSvg();
    expect(svg).toContain(BRAND.wordmark);
    expect(svg).toContain(BRAND.accentWord);
    expect(svg).toContain(BRAND.tagline);
    expect(svg).toContain("v" + DESIGN_SYSTEM_VERSION);
    expect(svg).toContain(TOKENS.color.acc);
  });

  test("tokenRgb parses token hex via the browser-safe kernel", () => {
    expect(tokenRgb("#4da3ff")).toEqual({ r: 77, g: 163, b: 255 });
    expect(tokenRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe("Bun.image metadata + conversion", () => {
  const tmp = "/tmp/brand-test-" + Math.random().toString(36).slice(2);
  const pngPath = tmp + ".png";

  test("swatch PNG decodes with expected dimensions and format", async () => {
    await Bun.write(pngPath, brandSwatchPng(TOKENS.color.acc, 48));
    const meta = await readImageMeta(pngPath);
    expect(meta).not.toBeNull();
    expect(meta!.width).toBe(48);
    expect(meta!.height).toBe(48);
    expect(meta!.format).toBe("png");
    expect(meta!.bytes).toBeGreaterThan(0);
  });

  test("readImageMeta tolerates missing/unsupported files", async () => {
    expect(await readImageMeta("/tmp/no-such-file-" + Math.random().toString(36) + ".png")).toBeNull();
    const txt = tmp + ".txt";
    await Bun.write(txt, "not an image");
    expect(await readImageMeta(txt)).toBeNull();
  });

  test("convertImageFile re-encodes png -> webp (ground truth on disk)", async () => {
    await Bun.write(pngPath, brandSwatchPng(TOKENS.color.warn, 32));
    const webpPath = tmp + ".webp";
    const out = await convertImageFile(pngPath, webpPath, { format: "webp" });
    expect(out).not.toBeNull();
    expect(out!.format).toBe("webp");
    expect(out!.width).toBe(32);
    expect(out!.height).toBe(32);
  });

  test("convertImageFile resizes", async () => {
    await Bun.write(pngPath, brandSwatchPng(TOKENS.color.bad, 64));
    const resized = tmp + "-r.png";
    const out = await convertImageFile(pngPath, resized, { width: 16, height: 16 });
    expect(out!.width).toBe(16);
    expect(out!.height).toBe(16);
  });
});
describe("Bun.Image constructor pipeline (bun-v1.4 API)", () => {
  test("in-memory decode + transformImage with fit/rotate/encode", async () => {
    const { meta } = await transformImage(brandSwatchPng(TOKENS.color.acc, 64), {
      width: 128,
      fit: "inside",
      rotate: 90,
      format: "webp",
      quality: 85,
    });
    expect(meta.width).toBe(128);
    expect(meta.height).toBe(128);
    expect(meta.format).toBe("webp");
  });

  test("transformed Image streams into a Response body", async () => {
    const { image } = await transformImage(brandSwatchPng(TOKENS.color.ok, 32), { format: "jpeg" });
    const resp = imageResponse(image);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("image/jpeg");
    const body = await resp.arrayBuffer();
    expect(body.byteLength).toBeGreaterThan(0);
  });

  test("decodeImage is lazy; metadata() rejects non-image bytes", async () => {
    const img = decodeImage(new TextEncoder().encode("not an image"));
    await expect(img.metadata()).rejects.toThrow();
  });
});

describe("brand card raster (Bun.WebView)", () => {
  test("raster contract: WebView presence (no live capture in the merge gate)", () => {
    // WebKit is UNRELIABLE under bun test --parallel — screenshots can throw
    // "WebView closed"/"Completion handler..." from outside the awaited chain,
    // and captures can return corrupt buffers. The repo's own WebView tests
    // never screenshot in the merge gate. The REAL capture + 1200x630
    // verification lives in bun run brand:card (CLI, ground-tool pattern)
    // and the serve smoke (/brand/card.png). This test asserts only the
    // deterministic contract: the capability is present when WebView exists.
    if (typeof Bun.WebView === "function") {
      expect(hasWebView()).toBe(true);
    } else {
      expect(hasWebView()).toBe(false);
    }
  });
});
describe("brand templates + validation", () => {
  test("badge/quote/chart SVGs are token-compliant", () => {
    expect(designAgent.audit(brandBadgeSvg("ok", "LIVE")).issues).toEqual([]);
    expect(designAgent.audit(brandBadgeSvg("bad", "stale")).issues).toEqual([]);
    expect(designAgent.audit(brandQuoteSvg("The edge is real.", "Research")).issues).toEqual([]);
    expect(designAgent.audit(brandChartSvg([10, 20, 30, 40])).issues).toEqual([]);
  });

  test("templates clamp text and values", () => {
    const badge = brandBadgeSvg("ok", "x".repeat(80)); // 80 chars -> 40
    expect(badge).toContain("X".repeat(40)); // uppercased + clamped
    expect(badge).not.toContain("x".repeat(41));
    const chart = brandChartSvg([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]); // 13 values -> 12 bars
    // 12 bars + 2 background rects = 14 total <rect> elements
    expect((chart.match(/<rect/g) ?? []).length).toBe(14);
  });

  test("chart max bar uses the ok token", () => {
    const chart = brandChartSvg([5, 10]);
    expect(chart).toContain(TOKENS.color.ok);
    expect(chart).toContain(TOKENS.color.acc);
  });

  test("clampDim clamps to 100-4000 and falls back", () => {
    expect(clampDim("50", 1200)).toBe(100);
    expect(clampDim("99999", 1200)).toBe(4000);
    expect(clampDim("abc", 1200)).toBe(1200);
    expect(clampDim(null, 630)).toBe(630);
    expect(clampDim("640", 1200)).toBe(640);
  });

  test("validateFontUrl allows https fonts, rejects others", () => {
    expect(validateFontUrl("https://fonts.googleapis.com/css2?family=Inter")).toMatch(/^https:/);
    expect(validateFontUrl("http://example.com/font.css")).toBeNull();
    expect(validateFontUrl("https://localhost/font.css")).toBeNull();
    expect(validateFontUrl("javascript:alert(1)")).toBeNull();
    expect(validateFontUrl(undefined)).toBeNull();
  });
});
