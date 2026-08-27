#!/usr/bin/env bun
/**
 * canonical:asset — CLI for the canonical digital-asset generator.
 *
 *   bun run canonical:asset -- --input=artifacts/brand-card.png
 *       [--out=artifacts/canonical] [--name=brand-card] [--width=512]
 *       [--height=512] [--fit=inside|fill] [--timestamp=<ms>] [--sort-arrays]
 *       [--schema=<url>] [--source-hash] [CANONICAL_METADATA_SECRET=...]
 *
 * Writes:
 *   <out>/<name>.png             processed PNG payload
 *   <out>/<name>.metadata.json   normalized + key-sorted metadata
 * Prints the 0x asset hash and metadata digest (the on-chain tuple).
 *
 * @see src/lib/canonical-asset.ts (grounding + determinism contract)
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { generateCanonicalAsset } from "../src/lib/canonical-asset.ts";
import { parseArgs } from "node:util";

const { values: cav, positionals: caPos } = parseArgs({ args: Bun.argv.slice(2), options: { height: { type: 'string' }, fit: { type: 'string' }, schema: { type: 'string' }, 'sort-arrays': { type: 'boolean' }, 'source-hash': { type: 'boolean' }, timestamp: { type: 'string' } }, strict: false, allowPositionals: true });
const flag = (name: string): string => {
  return typeof cav[name] === 'string' ? (cav[name] as string) : '';
};

const input = flag("input") || (Bun.env.CANONICAL_INPUT ?? "");
if (!input) {
  console.error("canonical:asset: --input=<image path> required");
  process.exit(1);
}
const outDir = flag("out") || join(import.meta.dir, "..", "artifacts", "canonical");
const name = flag("name") || "asset";
const width = Number(flag("width") || 1024) || 1024;
const height = Number(flag("height") || 1024) || 1024;
const fit = (flag("fit") || "inside") as "inside" | "fill";
const sortArrays = cav['sort-arrays'] === true;
const schema = flag("schema") || undefined;
const tsFlag = typeof cav.timestamp === 'string' ? cav.timestamp : undefined;

if (fit !== "inside" && fit !== "fill") {
  console.error("canonical:asset: fit must be inside | fill (Bun 1.4.0 fit set)");
  process.exit(1);
}

const opts: Parameters<typeof generateCanonicalAsset>[1] = {
  name,
  width,
  height,
  fit,
  sortArrays,
  ...(schema ? { schema } : {}),
  ...(tsFlag ? { timestamp: Number(tsFlag.slice("--timestamp=".length)) } : {}),
  ...(cav["source-hash"] === true ? { sourceHash: true } : {}),
  ...(Bun.env.CANONICAL_METADATA_SECRET ? { hmacSecret: Bun.env.CANONICAL_METADATA_SECRET } : {}),
};
const asset = await generateCanonicalAsset(input, opts);

mkdirSync(outDir, { recursive: true });
const pngPath = join(outDir, name + ".png");
const metaPath = join(outDir, name + ".metadata.json");
await Bun.write(pngPath, asset.processedImage);
await Bun.write(metaPath, JSON.stringify(asset.metadata, null, 2) + String.fromCharCode(10));

console.error("canonical:asset ok -> " + pngPath + " (" + asset.processedImage.length + " B) + " + metaPath);
console.error("assetHash:       " + asset.assetHash);
console.error("metadataDigest:  " + asset.metadataDigest);