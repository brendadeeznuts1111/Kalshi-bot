#!/usr/bin/env bun
/**
 * Color conversion micro-benchmark — cached kernel vs raw Bun.color.
 *
 * Run: bun run colors:bench
 *
 * @see https://bun.com/docs/runtime/color#flexible-input
 * @see src/lib/color/kernel.ts
 */
import { COLORS, cssColor, type ColorKey } from "../src/lib/color/index.ts";

const keys = Object.keys(COLORS) as ColorKey[];
const ITER = 50_000;

function time(label: string, fn: () => void): number {
  // Warm
  fn();
  const t0 = Bun.nanoseconds();
  fn();
  const ms = (Bun.nanoseconds() - t0) / 1e6;
  console.log(`${label.padEnd(28)} ${ms.toFixed(2)} ms  (${ITER} × ${keys.length} keys)`);
  return ms;
}

const rawMs = time("Bun.color per call", () => {
  for (let i = 0; i < ITER; i++) {
    for (const key of keys) {
      Bun.color(COLORS[key], "css");
    }
  }
});

const cachedMs = time("cached cssColor", () => {
  for (let i = 0; i < ITER; i++) {
    for (const key of keys) {
      cssColor(key);
    }
  }
});

const speedup = rawMs / Math.max(cachedMs, 0.001);
console.log(`\nspeedup: ${speedup.toFixed(1)}× (cache vs raw)`);
