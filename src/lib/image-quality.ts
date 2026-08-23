/**
 * Bun.Image decision-gate primitives (metadata() as the cheap gate).
 *
 * Verified on 1.4.0: metadata() reads the header without decoding pixels;
 * the same instance can chain metadata -> resize -> format -> bytes();
 * .bytes() returns the ENCODED output (PNG signature confirmed), and there
 * is NO pixel-decode API (decode/pixels/toPixels undefined) - so any
 * 'average color from pixels' pattern is not implementable with Bun.Image
 * alone on this build.
 *
 * @see docs/AGENT-PITFALLS.md 8m (verified pattern matrix)
 */

import type { BunFile } from "bun";

export type ImageDimensions = { width: number; height: number };

/**
 * Adaptive encode quality from dimensions (Pattern 5): large images need
 * higher quality (displayed larger); small icons can be compressed harder.
 */
export function getOptimalQuality(meta: ImageDimensions): number {
  const pixels = meta.width * meta.height;
  if (pixels > 12_000_000) return 75; // 4K+
  if (pixels > 4_000_000) return 80;  // 1080p
  if (pixels > 1_000_000) return 85;  // 720p
  return 90;
}

/**
 * metadata() as the cheap decision gate: read the header once, then run
 * the processor against the same (still reusable) pipeline. Mirrors the
 * processWithMetadata pattern with verified chaining semantics.
 */
export async function metadataGate<T>(
  input: string | BunFile,
  processor: (meta: { width: number; height: number; format: string }, img: Bun.Image) => Promise<T>,
): Promise<T> {
  const file = typeof input === "string" ? Bun.file(input) : input;
  const img = file.image();
  const meta = await img.metadata();
  return processor(meta, img);
}
