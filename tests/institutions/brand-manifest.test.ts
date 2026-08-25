import { describe, expect, test } from "bun:test";
import {
  BRAND_MANIFEST,
  BRAND_METRIC_KEYS,
  BRAND_SUMMARY,
  brandAssetByRoute,
} from "../../src/institutions/brand-manifest.ts";

describe("brand manifest", () => {
  test("every asset has route/method/contentType/cache/generator + provenance", () => {
    for (const a of BRAND_MANIFEST) {
      expect(a.route.startsWith("/brand") || a.route.startsWith("/api/brand")).toBe(true);
      expect(["GET", "POST"].includes(a.method)).toBe(true);
      expect(a.contentType.length).toBeGreaterThan(0);
      expect(a.cache.length).toBeGreaterThan(0);
      expect(a.generator.length).toBeGreaterThan(0);
      expect(a.provenance.length).toBeGreaterThan(0);
    }
  });

  test("routes are unique and resolvable", () => {
    const seen = new Set<string>();
    for (const a of BRAND_MANIFEST) {
      expect(seen.has(a.route), "duplicate route " + a.route).toBe(false);
      seen.add(a.route);
      expect(brandAssetByRoute(a.route)).toBe(a);
    }
  });

  test("metric keys match the BrandMetricsSnapshot shape exactly", () => {
    expect(new Set(BRAND_METRIC_KEYS)).toEqual(
      new Set(["badge", "card", "chart", "purges", "quote", "svg", "swatch"]),
    );
  });

  test("BRAND_SUMMARY carries the Kalshi HQ identity", () => {
    expect(BRAND_SUMMARY.name).toBe("Kalshi HQ");
    expect(BRAND_SUMMARY.wordmark).toBe("KALSHI");
    expect(BRAND_SUMMARY.accentWord).toBe("HQ");
    expect(BRAND_SUMMARY.tagline).toContain("Research");
  });
});
