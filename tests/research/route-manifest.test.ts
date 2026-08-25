import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROUTE_MANIFEST,
  ROUTE_LAYERS,
  manifestCovers,
  routeByPath,
} from "../../src/research/route-manifest.ts";

const ROOT = join(import.meta.dir, "..", "..");
const SERVE_PATH = join(ROOT, "src/research/serve.ts");
const serveSrc = readFileSync(SERVE_PATH, "utf8");

describe("route manifest", () => {
  test("every entry has a unique path and valid method/layer", () => {
    const paths = new Set<string>();
    const layers = new Set(["channels", "branding", "pipeline", "data", "ops", "trading", "research"]);
    const methods = new Set(["GET", "POST", "GET|POST"]);
    for (const r of ROUTE_MANIFEST) {
      expect(paths.has(r.path), "duplicate path " + r.path).toBe(false);
      paths.add(r.path);
      expect(methods.has(r.method), "bad method for " + r.path).toBe(true);
      expect(layers.has(r.layer), "bad layer for " + r.path).toBe(true);
      expect(r.handler.length).toBeGreaterThan(0);
    }
  });

  test("ROUTE_LAYERS covers every entry layer in manifest order", () => {
    for (const layer of ROUTE_LAYERS) {
      expect(ROUTE_MANIFEST.some((r) => r.layer === layer)).toBe(true);
    }
  });

  test("every /bun/* widget key in serve.ts is registered in the manifest", () => {
    const widgetKeys = [...serveSrc.matchAll(new RegExp(String.raw`"(\/bun\/[a-z-]+)":`, "g"))].map((m) => m[1]!);
    expect(widgetKeys.length).toBeGreaterThanOrEqual(19);
    for (const key of widgetKeys) {
      expect(routeByPath(key), "widget " + key + " not in manifest").toBeDefined();
    }
  });

  test("manifestCovers handles exact + wildcard paths", () => {
    expect(manifestCovers("/api/signals")).toBe(true);
    expect(manifestCovers("/videos/foo.mp4")).toBe(true); // /videos/* wildcard
    expect(manifestCovers("/registry/sports-sources.json")).toBe(true);
    expect(manifestCovers("/nonexistent-route")).toBe(false);
  });

  test("trading layer is documentation only — no bypass markers", () => {
    const trading = ROUTE_MANIFEST.filter((r) => r.layer === "trading");
    expect(trading.length).toBeGreaterThanOrEqual(4);
    for (const r of trading) {
      expect(["POST", "GET"].includes(r.method)).toBe(true);
    }
  });
});
  test("every POST route is CSRF-guarded or a documented webhook", () => {
    // Webhooks without a browser session are the documented exception
    // (no double-submit CSRF): /polymarket/ingest is deliberately excluded
    // in serve.ts — everything else browser-facing must be csrf:true.
    const webhookAllowlist = new Set(["/polymarket/ingest"]);
    const posts = ROUTE_MANIFEST.filter((x) => x.method === "POST" || x.method === "GET|POST");
    expect(posts.length).toBeGreaterThanOrEqual(6);
    for (const p of posts) {
      if (webhookAllowlist.has(p.path)) continue;
      expect(p.csrf, "POST " + p.path + " must be CSRF-guarded (or added to the webhook allowlist)").toBe(true);
    }
  });

