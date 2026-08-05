#!/usr/bin/env bun
/**
 * Print Partner domain architecture status (five layers).
 *
 *   bun run partner:domain
 *   bun run partner:domain -- --json
 *
 * @see docs/PARTNER-DOMAIN.md
 * @see src/partner/domain.ts
 */
import {
  buildDomainStatusReport,
  formatDomainStatusText,
} from "../src/partner/domain.ts";

const json = process.argv.includes("--json");
const report = buildDomainStatusReport();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatDomainStatusText(report));
  console.log("\n  · docs: docs/PARTNER-DOMAIN.md");
}
