#!/usr/bin/env bun
/**
 * Surface audit — verify every glossary ID referenced on a page surface
 * is declared in PAGE_SURFACES for that surface.
 *
 * Run:  bun scripts/surface-audit.ts
 * Gate: exit 1 if undeclared glossary IDs are found in source files
 *
 * @see src/institutions/glossary.ts — PAGE_SURFACES SSOT
 */
import { PAGE_SURFACES, type PageSurface } from "../src/institutions/glossary.ts";
import { GLOSSARY_ENTRIES } from "../src/institutions/glossary.ts";

// Tone→surface ownership rules
const TONE_SURFACE_RULES: Record<string, PageSurface> = {
  metric: "hq",
  alert: "ops",
};

const surfaces = Object.keys(PAGE_SURFACES) as PageSurface[];

// Map: file prefix → expected surface
const FILE_SURFACE_MAP: Record<string, PageSurface> = {
  "src/research/hq-view.ts": "hq",
  "src/research/hq-app/": "hq",
  "src/research/views.ts": "ops",
  "src/research/serve.ts": "ops",
};

const GLOSSARY_ID_RE = /"(kpi\.\w+|alert\.\w+|ops\.\w+|kalshi_\w+|poly_\w+|elo_\w+|eff_edge|rps_flag|graph_divergence|liquidity_ok|total_volume_usd)"/g;

let violations = 0;

for (const [filePrefix, expectedSurface] of Object.entries(FILE_SURFACE_MAP)) {
  const allowed = new Set<string>(PAGE_SURFACES[expectedSurface]);
  const files = await Array.fromAsync(new Bun.Glob(`${filePrefix}*`).scan());

  for (const file of files) {
    const content = await Bun.file(file).text();
    const matches = [...content.matchAll(GLOSSARY_ID_RE)];

    for (const m of matches) {
      const id = m[1];
      if (!allowed.has(id)) {
        const lineNum = content.slice(0, m.index!).split("\n").length;
        console.error(
          `❌ ${file}:${lineNum}  "${id}" — not declared in PAGE_SURFACES.${expectedSurface}`,
        );
        violations++;
      }
    }
  }
}

if (violations) {
  console.error(`\n${violations} undeclared glossary concept(s). Fix by adding to PAGE_SURFACES.`);
  process.exit(1);
}

// Tone→surface ownership check
for (const [tone, expectedSurface] of Object.entries(TONE_SURFACE_RULES)) {
  const entries = GLOSSARY_ENTRIES.filter(e => e.tone === tone);
  for (const e of entries) {
    const declared = (PAGE_SURFACES[expectedSurface] as readonly string[]);
    if (!declared.includes(e.id)) {
      console.error(`❌ ${e.id} (tone=${tone}) — not in PAGE_SURFACES.${expectedSurface}`);
      violations++;
    }
  }
}

console.log(`✅ Surface audit clean — ${surfaces.length} surfaces verified`);
