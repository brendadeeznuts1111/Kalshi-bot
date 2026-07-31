#!/usr/bin/env bun
/**
 * Color audit — fail if any #RRGGBB in source files is not routed through COLORS.*
 *
 * Run:  bun scripts/audit-colors.ts
 * Gate: exit 1 if orphan hexes or hardcoded palette colors found
 *
 * @see src/lib/color/palette.ts — SSOT
 */
import { COLORS } from "../src/lib/color/index.ts";

const COLOR_RE = /#[0-9A-Fa-f]{6}\b/g;
const EXCLUDED = new Set([
  "src/lib/design-colors.ts",
  "src/lib/color/palette.ts",
  "src/lib/color/kernel.ts",
  "src/lib/color/browser-constants.ts", // macro inputs must be literal hex
  "src/institutions/venue-badge.ts", // ColorKey consumers
  "src/institutions/glossary.ts", // color descriptions in glossary values
  "src/institutions/design-tokens.ts", // CSS/web design system — separate palette
  "src/institutions/event-store/tennis-ws-dashboard.ts", // inline CSS for dashboard
  "src/research/hq-view.ts", // inline CSS for HQ
  "scripts/generate-color-docs.ts",
  "scripts/generate-color-artifacts.ts",
  "scripts/check-contrast.ts",
  "scripts/benchmark-color.ts",
  "scripts/audit-colors.ts",
]);

const PALETTE = new Set(Object.values(COLORS).map((c) => c.toLowerCase()));

const files = await Array.fromAsync(new Bun.Glob("src/**/*.{ts,tsx}").scan());

let violations = 0;

for (const file of files) {
  if (EXCLUDED.has(file)) continue;

  const content = await Bun.file(file).text();
  const matches = [...content.matchAll(COLOR_RE)];

  for (const m of matches) {
    const hex = m[0].toLowerCase();
    const lineNum = content.slice(0, m.index!).split("\n").length;

    if (!PALETTE.has(hex)) {
      console.error(`❌ ${file}:${lineNum}  orphan #${hex} — not in COLORS palette`);
      violations++;
    } else if (!content.includes("COLORS") && !content.includes("design-colors")) {
      console.error(`❌ ${file}:${lineNum}  hardcoded palette color #${hex} — import from src/lib/color`);
      violations++;
    }
  }
}

if (violations) {
  console.error(`\n${violations} color violation(s). Fix before shipping.`);
  process.exit(1);
}

console.log(`✅ Color audit clean — ${files.length} src files checked`);
