#!/usr/bin/env bun
/**
 * brand-package-gen — regenerate the publishable kalshi-brand package
 * (packages/brand) from the repo design system: tokens.json + verified
 * brand-card.png + solid token swatches. The PACKAGE is self-contained
 * (no root imports) — this generator is the one-way bridge.
 *
 *   bun run brand:pkg:generate   # regen packages/brand assets
 *   bun run brand:pkg:check      # pack --dry-run + publish --dry-run
 *
 * Validation: brand-card.png must be an EXACT 1200x630 PNG (same gate as
 * `bun run brand:card`); generation fails otherwise.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BRAND, DESIGN_SYSTEM_VERSION, TOKENS } from "../src/institutions/design-tokens.ts";
import { brandSwatchPng, readImageMeta } from "../src/lib/brand-image.ts";

const ROOT = join(import.meta.dir, "..");
const PKG = join(ROOT, "packages", "brand");
const ASSETS = join(PKG, "assets");
const SWATCHES = join(ASSETS, "swatches");

// 1. verified brand-card.png — copy the artifact the brand:card gate verified
const srcCard = join(ROOT, "artifacts", "brand-card.png");
const meta = await readImageMeta(srcCard);
if (!meta || meta.format !== "png" || meta.width !== 1200 || meta.height !== 630) {
  console.error("brand:pkg:generate — artifacts/brand-card.png is not a verified 1200x630 PNG (" + JSON.stringify(meta) + "); run bun run brand:card first");
  process.exit(1);
}
mkdirSync(SWATCHES, { recursive: true });
await Bun.write(join(ASSETS, "brand-card.png"), Bun.file(srcCard));

// 2. solid token swatches (hex-valued TOKENS.color entries)
const swatchKeys: string[] = [];
for (const [key, value] of Object.entries(TOKENS.color)) {
  if (typeof value === "string" && value.startsWith("#")) {
    await Bun.write(join(SWATCHES, key + ".png"), brandSwatchPng(value, 64));
    swatchKeys.push(key);
  }
}

// 3. tokens.json — self-contained, versioned
const tokens = {
  designSystemVersion: DESIGN_SYSTEM_VERSION,
  brand: BRAND,
  tokens: TOKENS,
  swatches: swatchKeys,
  generatedAt: new Date().toISOString(),
};
await Bun.write(join(PKG, "tokens.json"), JSON.stringify(tokens, null, 2) + "\n");

console.log("brand:pkg:generate — " + swatchKeys.length + " swatches + tokens.json + brand-card.png (verified " + meta.width + "x" + meta.height + ")");
