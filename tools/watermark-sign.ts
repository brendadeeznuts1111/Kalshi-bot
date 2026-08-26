#!/usr/bin/env bun
/**
 * watermark:sign — CLI for the watermark+sign pipeline.
 *
 *   bun run watermark:sign -- --text="TOKEN -> recipient" [--url=https://bun.sh/logo.png] [--out=/tmp/watermarked]
 *
 * Fetches the image (http2), resizes via Bun.Image, watermarks it (SVG →
 * Bun.WebView), signs the PNG with ml-dsa-65, and writes:
 *   <out>.png        the watermarked image
 *   <out>.png.sig    the raw ML-DSA signature
 *   <out>.pub.pem    the SPKI public key
 * Then verifies the signature.
 */
import { join } from 'node:path';
import { verify } from 'node:crypto';
import { watermarkAndSign } from '../src/lib/watermark-sign.ts';

const flags = Bun.argv.slice(2);
const text = (flags.find((f) => f.startsWith('--text=')) ?? '').slice('--text='.length) ||
  (process.env.TOKEN ?? 'abc123') + ' -> ' + (process.env.RECIPIENT ?? 'alice@example.com');
const url = (flags.find((f) => f.startsWith('--url=')) ?? '').slice('--url='.length) || 'https://bun.sh/logo.png';
const outBase = (flags.find((f) => f.startsWith('--out=')) ?? '').slice('--out='.length) || join(import.meta.dir, '..', 'artifacts', 'watermarked');
const width = Number((flags.find((f) => f.startsWith('--width=')) ?? '').slice('--width='.length) || 400);

// 1) fetch + resize to a data: URL (background for the watermark)
const res = await fetch(url, { protocol: 'http2' });
if (!res.ok) { console.error('watermark:sign: fetch failed', res.status); process.exit(1); }
const img = new Bun.Image(await res.arrayBuffer()).resize(width);
const bytes = await img.png().bytes();
const dataUrl = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');

// 2) watermark (SVG → WebView) + sign (ml-dsa-65)
const asset = await watermarkAndSign({ text, imageDataUrl: dataUrl, width, height: width });

// 3) write outputs
await Bun.write(outBase + '.png', asset.png);
await Bun.write(outBase + '.png.sig', asset.signature);
await Bun.write(outBase + '.pub.pem', asset.publicKeyPem);

// 4) verify
const { createPublicKey } = await import('node:crypto');
const pem = await Bun.file(outBase + '.pub.pem').text();
const ok = verify(null, asset.png, createPublicKey(pem), asset.signature);
console.error('watermark:sign ok -> ' + outBase + '.png (' + asset.png.length + ' B) · sig ' + asset.signature.length + ' B · ' + asset.keyType + ' · self-verify ' + ok);
