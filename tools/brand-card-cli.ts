#!/usr/bin/env bun
/**
 * `bun run brand:card` — capture + VERIFY the rasterized brand card.
 *
 * The merge-gate test only asserts the contract (WebView screenshots are
 * unreliable under --parallel); the REAL capture + exact 1200x630 check
 * lives here (ground-tool pattern, like tennis-ws-ground).
 *
 *   bun run brand:card            # capture, verify, write artifacts/brand-card.png
 *   bun run brand:card -- --out=…  # custom output path
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { brandCardPng, readImageMeta } from '../src/lib/brand-image.ts';
import { parseArgs } from 'node:util';

const root = join(import.meta.dir, '..');
const { values: bv } = parseArgs({ args: Bun.argv.slice(2), options: { out: { type: 'string' } }, strict: false, allowPositionals: true });
const outPath = typeof bv.out === 'string' ? bv.out : join(root, 'artifacts/brand-card.png');

if (typeof Bun.WebView !== 'function') {
  console.error('brand:card: Bun.WebView unavailable — cannot rasterize');
  process.exit(1);
}
const png = await brandCardPng({ width: 1200, height: 630 });
if (!png) {
  console.error('brand:card: capture failed (WebKit busy?) — retry or check the log');
  process.exit(1);
}
mkdirSync(join(outPath, '..'), { recursive: true });
await Bun.write(outPath, png);
const meta = await readImageMeta(outPath);
if (!meta || meta.format !== 'png' || meta.width !== 1200 || meta.height !== 630) {
  console.error('brand:card: verification FAILED', JSON.stringify(meta));
  process.exit(1);
}
console.error('brand:card ok -> ' + outPath + ' (' + png.length + ' B, ' + meta.width + 'x' + meta.height + ' png)');
