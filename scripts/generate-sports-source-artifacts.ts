#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildSportsSourceRegistryArtifact } from "../src/institutions/market-registry/registry.ts";

const root = join(import.meta.dir, "..");
const outputPath = join(root, "public/registry/sports-sources.json");
const { values: ssv } = parseArgs({ args: Bun.argv.slice(2), options: { check: { type: 'boolean' } }, strict: false, allowPositionals: true });
const checkOnly = ssv.check === true;

function stableBody(generatedAt: string): string {
  return `${JSON.stringify(buildSportsSourceRegistryArtifact(generatedAt), null, 2)}\n`;
}

if (checkOnly) {
  const file = Bun.file(outputPath);
  if (!(await file.exists())) {
    console.error("public/registry/sports-sources.json missing — run bun run sports:registry:bake");
    process.exit(1);
  }
  const actual = JSON.parse(await file.text()) as { generatedAt?: unknown };
  if (typeof actual.generatedAt !== "string") {
    console.error("public sports/source registry has no generatedAt timestamp");
    process.exit(1);
  }
  const expected = JSON.parse(stableBody(actual.generatedAt));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error("public/registry/sports-sources.json stale — run bun run sports:registry:bake");
    process.exit(1);
  }
  console.log("sports/source registry: current");
} else {
  mkdirSync(join(root, "public/registry"), { recursive: true });
  await Bun.write(outputPath, stableBody(new Date().toISOString()));
  console.log("sports/source registry: wrote public/registry/sports-sources.json");
}
