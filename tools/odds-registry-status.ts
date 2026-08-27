#!/usr/bin/env bun
/**
 * `bun run odds-registry:status [--out=public/registry/status.webp] [--format=png|webp] [--tone=ok|warn|bad] [--headline=...] [--subline=...] [--json]`
 *
 * Renders the odds-registry status card via the verified WebView rasterizer
 * (Bun.Image cannot decode SVG on 1.4.0 — probed) and writes a PNG/WebP file.
 * Default headline/subline come from the live config health summary.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { loadOddsRegistryConfig, oddsRegistryHealth, statusCardPng, statusCardSvg } from "../src/institutions/odds-registry/index.ts";

const { values: v } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    out: { type: "string" },
    format: { type: "string" },
    tone: { type: "string" },
    headline: { type: "string" },
    subline: { type: "string" },
    json: { type: "boolean" },
  },
  strict: false,
  allowPositionals: true,
});
const arg = (name: string): string | undefined =>
  typeof v[name] === "string" ? (v[name] as string) : undefined;

const ROOT = join(import.meta.dir, "..");
const cfg = await loadOddsRegistryConfig(ROOT);
const h = oddsRegistryHealth(cfg);
const tone = (arg("tone") ?? (h.ok ? "ok" : "bad")) as "ok" | "warn" | "bad";
const headline = arg("headline") ?? `${h.bookmakerCount} bookmakers — capacity floor ${h.capacityFloor}`;
const subline =
  arg("subline") ??
  `feeds: ${Object.entries(h.feeds).map(([k, n]) => `${k} ${n}`).join(" · ")} — sports: ${h.sports.length}`;

const svg = statusCardSvg(tone, headline, subline);
if (v.json) {
  console.log(JSON.stringify({ tone, headline, subline, health: h, svg }, null, 2));
  process.exit(0);
}

const png = await statusCardPng(tone, headline, subline);
if (!png) {
  console.error("odds-registry:status: WebView rasterization failed (3 attempts)");
  process.exit(1);
}
const format = (arg("format") ?? "png").toLowerCase();
const out = arg("out") ?? `public/registry/status.${format}`;
await Bun.write(out, new Blob([png], { type: format === "webp" ? "image/webp" : "image/png" }));
console.log(`wrote ${out} (${png.length} bytes, ${format}, tone=${tone})`);

