#!/usr/bin/env bun
/**
 * Print Partner domain architecture status (five layers).
 *
 *   bun run partner:domain
 *   bun run partner:domain -- --json
 *   bun run partner:map
 *   bun run partner:map -- --output=artifacts/partner-expansion.mmd
 *
 * @see docs/PARTNER-DOMAIN.md
 * @see src/partner/domain.ts
 */
import {
  buildDomainStatusReport,
  formatDomainStatusText,
  formatPartnerExpansionMermaid,
} from "../src/partner/domain.ts";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const json = process.argv.includes("--json");
const map = process.argv.includes("--map") || process.argv.includes("--mermaid");
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const outputPath = outputArg?.slice("--output=".length).trim();
if (json && map) throw new TypeError("Choose one of --json or --map/--mermaid");
if (outputArg && !outputPath) throw new TypeError("--output requires a path");

if (map) {
  const content = `${formatPartnerExpansionMermaid()}\n`;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, content);
    console.error(`wrote partner expansion map: ${outputPath}`);
  } else {
    console.log(content.trimEnd());
  }
  process.exit(0);
}

const report = buildDomainStatusReport();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatDomainStatusText(report));
  console.log("\n  · docs: docs/PARTNER-DOMAIN.md");
}
