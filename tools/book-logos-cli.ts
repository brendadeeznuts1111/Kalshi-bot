#!/usr/bin/env bun
/**
 * `bun run book:logos [--force]`
 *
 * Bake branded bookmaker logo PNGs (public/assets/books/<key>.png) for every
 * registry book. Idempotent — existing assets are skipped unless --force.
 * Once baked, the bookmaker store's conventional logo fallback lights up the
 * report's Logo column with zero config edits.
 */
import { loadOddsRegistryConfig } from "../src/institutions/odds-registry/load.ts";
import { ensureBookLogos } from "../src/institutions/odds-registry/book-logos.ts";

const root = import.meta.dir + "/..";
const cfg = await loadOddsRegistryConfig(root);
const { written, skipped, failed } = await ensureBookLogos(cfg, root, { force: Bun.argv.includes("--force") });

console.log(`book:logos — written: ${written.length} · skipped: ${skipped.length} · failed: ${failed.length}`);
if (written.length) console.log("  wrote: " + written.join(", "));
if (failed.length) {
  console.error("  FAILED: " + failed.join(", "));
  process.exit(1);
}
