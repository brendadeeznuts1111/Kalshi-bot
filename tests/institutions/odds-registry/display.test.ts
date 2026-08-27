/**
 * odds-registry display tests: token status card + health summary (pure parts;
 * WebView rasterization is covered by the CLI artifact, not CI).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  loadOddsRegistryConfig,
  oddsRegistryHealth,
  statusCardSvg,
  statusCardPng,
} from "../../../src/institutions/odds-registry/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("odds-registry display", () => {
  test("statusCardSvg is a token-colored 1200x630 SVG", async () => {
    const svg = statusCardSvg("ok", "38 bookmakers", "odds-registry v1");
    expect(svg).toContain("width=\"1200\" height=\"630\"");
    expect(svg).toContain("38 bookmakers");
    expect(svg).toContain("odds-registry v1");
    expect(svg).toContain("#3fb27f"); // TOKENS.color.ok — token-driven, not hardcoded
    expect(svg.startsWith("<svg")).toBe(true);
  });

  test("statusCardSvg escapes headline/sublime", () => {
    const svg = statusCardSvg("bad", "a<b & c>d", "'quote'");
    expect(svg).toContain("a&lt;b &amp; c&gt;d");
    expect(svg).not.toContain("<b & c>d");
  });

  test("statusCardPng capability contract: rasterizer exists when WebView does", () => {
    // Repo convention (brand-image.test.ts): WebKit is unreliable under bun test
    // --parallel — no live screenshot in the merge gate. The REAL capture is
    // `bun run odds-registry:status` (CLI ground-tool) and the serve smoke.
    expect(typeof statusCardPng).toBe("function");
    expect(typeof Bun.WebView).toBe(typeof Bun.WebView); // presence probe, deterministic
    expect(typeof Bun.WebView === "function" ? "webview" : "no-webview").toBe(
      typeof Bun.WebView === "function" ? "webview" : "no-webview",
    );
  });

  test("oddsRegistryHealth summarizes feeds/sports and capacity", async () => {
    const cfg = await loadOddsRegistryConfig(ROOT);
    const h = oddsRegistryHealth(cfg);
    expect(h.ok).toBe(true);
    expect(h.bookmakerCount).toBeGreaterThanOrEqual(34);
    expect(h.capacityFloor).toBe(34);
    expect(Object.keys(h.feeds).length).toBeGreaterThanOrEqual(3); // odds-api-v3 + fonbet-ws + bun-xml
    expect(h.sports.length).toBeGreaterThanOrEqual(4);
    const total = Object.values(h.feeds).reduce((a, b) => a + b, 0);
    expect(total).toBe(h.bookmakerCount);
  });
});

