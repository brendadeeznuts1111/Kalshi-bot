#!/usr/bin/env bun
/**
 * odds-registry:artifact — bake public/registry/odds-bookmakers.json from the XML config.
 *   bun run odds-registry:artifact   # write the artifact (fails if validation fails)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadOddsRegistryConfig, validateOddsRegistry } from "../src/institutions/odds-registry/index.ts";

const ROOT = import.meta.dir + "/..";
const cfg = await loadOddsRegistryConfig(ROOT);
const v = validateOddsRegistry(cfg);
if (!v.ok) {
  console.error("odds-registry:artifact — validation FAILED:");
  for (const e of v.errors) console.error("  - " + e);
  process.exit(1);
}
const out = join(ROOT, "public", "registry", "odds-bookmakers.json");
mkdirSync(join(out, ".."), { recursive: true });
const artifact = {
  schema: "odds-bookmakers/v1",
  capacityFloor: cfg.capacityFloor,
  bookmakerCount: v.bookmakerCount,
  feeds: v.feeds,
  sports: v.sports,
  bookmakers: cfg.bookmakers,
  generatedAt: new Date().toISOString(),
};
await Bun.write(out, JSON.stringify(artifact, null, 2) + "\n");
console.log("odds-registry:artifact — " + v.bookmakerCount + " bookmakers (" + v.sports.length + " sports, feeds " + v.feeds.join(",") + ") -> " + out);
