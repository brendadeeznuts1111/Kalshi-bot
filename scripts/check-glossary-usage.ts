#!/usr/bin/env bun
/**
 * Glossary governance — identify → map → govern → hard-fail.
 *
 * Modes:
 *   bun run glossary:check              # tip keys + integrity (always hard)
 *   bun run glossary:report             # also list ungoverned controlled labels (soft exit 0)
 *   bun run glossary:check -- --hard    # tip keys + integrity + controlled labels hard-fail
 *   bun run glossary:check -- --verbose
 *
 * Controlled-label scan: sel("Label", …) and explicit GOVERNED_SURFACES catalog.
 * Does not free-text-scan the whole repo (false positives).
 *
 * @see docs/SEMANTIC_LAYER.md
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildDeskColumnRegistry } from "../src/institutions/column-registry.ts";
import {
  GLOSSARY_ENTRIES,
  PENDING_REGISTRY_CONCEPTS,
  TOOLTIPS,
  buildGlossaryApiPayload,
} from "../src/institutions/glossary.ts";
import {
  glossaryMapFromEntries,
  validateGlossaryIntegrity,
} from "../src/institutions/validate-glossary-integrity.ts";
import { auditBoardFilterValues } from "../src/institutions/filter-catalog.ts";

const root = join(import.meta.dir, "..");
const scanRoots = [
  join(root, "src/research/hq-app"),
  join(root, "src/research/hq-view.ts"),
];

const hard = Bun.argv.includes("--hard");
const report = Bun.argv.includes("--report") || Bun.argv.includes("--report-only");
const verbose = Bun.argv.includes("--verbose");
const reportOnly = Bun.argv.includes("--report-only");

const known = new Set(GLOSSARY_ENTRIES.map((e) => e.id));
const tipRe = /\btip\s*\(\s*["']([A-Za-z0-9_.]+)["']\s*\)/g;
const dataGlossaryRe = /data-glossary=["']([A-Za-z0-9_.]+)["']/g;
/** sel("Label", …) or sel("Label", …, "glossaryId") */
const selRe = /\bsel\s*\(\s*["']([^"']+)["']\s*,/g;
/** selGloss("id", "Label", …) — governed */
const selGlossRe = /\bselGloss\s*\(\s*["']([A-Za-z0-9_.]+)["']\s*,\s*["']([^"']+)["']/g;

/**
 * Controlled surfaces: display text that must map to a glossary id when used as a label.
 * suggestedId is the required tip/selGloss key once --hard is on.
 */
const GOVERNED_SURFACES: Array<{
  text: string;
  suggestedId: string;
  suggestedKind: "ui" | "registry" | "composite";
}> = [
  { text: "League", suggestedId: "league", suggestedKind: "registry" },
  { text: "Surface", suggestedId: "surface", suggestedKind: "registry" },
  { text: "Tier", suggestedId: "tier", suggestedKind: "registry" },
  { text: "Round", suggestedId: "round", suggestedKind: "registry" },
  { text: "Tournament", suggestedId: "ui.events.filter.tournament", suggestedKind: "ui" },
  { text: "Country", suggestedId: "ui.events.filter.country", suggestedKind: "ui" },
  { text: "When", suggestedId: "ui.events.filter.when", suggestedKind: "ui" },
  { text: "Liquidity", suggestedId: "ui.events.filter.liquidity", suggestedKind: "ui" },
  { text: "Min 24h vol", suggestedId: "ui.events.filter.min_vol", suggestedKind: "ui" },
  { text: "Min surface edge", suggestedId: "ui.events.filter.min_surface_edge", suggestedKind: "ui" },
  { text: "Sort", suggestedId: "ui.sort.events", suggestedKind: "ui" },
  { text: "Tennis board", suggestedId: "ui.live_board.title", suggestedKind: "ui" },
  { text: "Live Board", suggestedId: "ui.live_board.title", suggestedKind: "ui" },
  { text: "Scanner", suggestedId: "ui.live_board.scanner", suggestedKind: "ui" },
  { text: "Divergence", suggestedId: "ui.live_board.divergence", suggestedKind: "ui" },
  { text: "Edge Score", suggestedId: "ui.live_board.edge_score", suggestedKind: "ui" },
  { text: "Model Suspect", suggestedId: "ui.live_board.model_suspect", suggestedKind: "ui" },
  { text: "Player profiles", suggestedId: "playerProfiles", suggestedKind: "ui" },
  { text: "Coverage", suggestedId: "coverage", suggestedKind: "ui" },
  { text: "Unclassified", suggestedId: "ui.filter.unclassified", suggestedKind: "ui" },
];

type Violation = {
  file: string;
  line: number;
  text: string;
  suggestedKind: "ui" | "registry" | "composite";
  suggestedId: string;
  reason: string;
};

function walk(path: string, out: string[]): void {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isFile()) {
    if (/\.(js|ts|html)$/.test(path)) out.push(path);
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    walk(join(path, name), out);
  }
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function surfaceFor(label: string) {
  const t = label.trim();
  return GOVERNED_SURFACES.find((s) => s.text.toLowerCase() === t.toLowerCase());
}

function main() {
  const files: string[] = [];
  for (const r of scanRoots) walk(r, files);

  const used = new Set<string>();
  const unknownTips: Array<{ file: string; key: string }> = [];
  const violations: Violation[] = [];

  // Track which controlled labels are already governed via tip/selGloss
  const governedHits = new Set<string>(); // suggestedId that has tip() or selGloss()

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(root, file);

    // tip / data-glossary keys
    for (const re of [tipRe, dataGlossaryRe]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const key = m[1]!;
        used.add(key);
        governedHits.add(key);
        if (!known.has(key)) unknownTips.push({ file: rel, key });
      }
    }

    // selGloss("id", "Label")
    selGlossRe.lastIndex = 0;
    let sm: RegExpExecArray | null;
    while ((sm = selGlossRe.exec(text))) {
      const id = sm[1]!;
      used.add(id);
      governedHits.add(id);
      if (!known.has(id)) unknownTips.push({ file: rel, key: id });
    }

    // sel("Label", …) — ungoverned if no tip on same line and Label is controlled
    selRe.lastIndex = 0;
    while ((sm = selRe.exec(text))) {
      // skip if this is actually selGloss (word boundary already; double-check)
      const start = sm.index;
      const before = text.slice(Math.max(0, start - 8), start);
      if (before.endsWith("selGloss") || before.endsWith("Gloss")) continue;

      const label = sm[1]!;
      const line = lineOf(text, start);
      const lineText = text.split("\n")[line - 1] ?? "";
      const surf = surfaceFor(label);
      if (!surf) continue;

      // Governed if tip(surf.suggestedId) on same line, or sel has 4th arg later — we use selGloss only
      const hasTip =
        lineText.includes(`tip("${surf.suggestedId}")`) ||
        lineText.includes(`tip('${surf.suggestedId}')`);
      if (hasTip) {
        governedHits.add(surf.suggestedId);
        continue;
      }
      violations.push({
        file: rel,
        line,
        text: label,
        suggestedKind: surf.suggestedKind,
        suggestedId: surf.suggestedId,
        reason: `sel("${label}") without tip("${surf.suggestedId}") or selGloss`,
      });
    }

    // Raw governed strings in <label>Text<input  (no tip on line)
    for (const surf of GOVERNED_SURFACES) {
      const re = new RegExp(`<label>${surf.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const line = lineOf(text, m.index);
        const lineText = text.split("\n")[line - 1] ?? "";
        if (
          lineText.includes(`tip("${surf.suggestedId}")`) ||
          lineText.includes(`tip('${surf.suggestedId}')`)
        ) {
          governedHits.add(surf.suggestedId);
          continue;
        }
        violations.push({
          file: rel,
          line,
          text: surf.text,
          suggestedKind: surf.suggestedKind,
          suggestedId: surf.suggestedId,
          reason: `<label>${surf.text} without tip("${surf.suggestedId}")`,
        });
      }
    }
  }

  // ── Always hard: unknown tip keys ──
  if (unknownTips.length && !reportOnly) {
    console.error("glossary:check FAIL — tip()/data-glossary/selGloss keys not in GLOSSARY_ENTRIES:");
    for (const u of unknownTips) console.error(`  ${u.file}: "${u.key}"`);
    process.exit(1);
  }

  // ── Integrity ──
  if (!reportOnly) {
    const payload = buildGlossaryApiPayload();
    if (payload.schemaVersion < 2 || !payload.entries.length || !Object.keys(TOOLTIPS).length) {
      console.error("glossary:check FAIL — payload invalid");
      process.exit(1);
    }
    const registry = buildDeskColumnRegistry();
    const gmap = glossaryMapFromEntries(GLOSSARY_ENTRIES);
    const integrity = validateGlossaryIntegrity(registry, gmap, {
      pendingRegistryConcepts: PENDING_REGISTRY_CONCEPTS,
    });
    if (integrity.length) {
      console.error("glossary:check FAIL — registry/glossary integrity:");
      for (const e of integrity) console.error(" ", e);
      process.exit(1);
    }

    const filterErrs = auditBoardFilterValues();
    if (filterErrs.length) {
      console.error("glossary:check FAIL — board filter catalogs:");
      for (const e of filterErrs) console.error(" ", e);
      process.exit(1);
    }
  }

  // ── Report / hard on controlled labels ──
  if (report || hard || verbose) {
    const bySuggestion = new Map<string, Violation[]>();
    for (const v of violations) {
      const key = `${v.suggestedKind}|${v.suggestedId}`;
      const list = bySuggestion.get(key) ?? [];
      list.push(v);
      bySuggestion.set(key, list);
    }

    if (report || violations.length) {
      console.log("\n--- Glossary controlled-label report ---");
      if (!violations.length) {
        console.log("No ungoverned controlled labels (sel / <label>).");
      }
      for (const [key, group] of [...bySuggestion.entries()].sort()) {
        const [kind, id] = key.split("|");
        console.log(`\n${kind}  "${id}"  (${group.length} hits)`);
        for (const v of group.slice(0, 5)) {
          console.log(`  ${v.file}:${v.line}  "${v.text}"  — ${v.reason}`);
        }
        if (group.length > 5) console.log(`  ... and ${group.length - 5} more`);
      }
      console.log(
        `\nTotal: ${violations.length} ungoverned controlled strings across ${
          new Set(violations.map((v) => v.file)).size
        } files`,
      );
      console.log(
        `Catalog surfaces: ${GOVERNED_SURFACES.length} · tip keys used: ${used.size} · glossary entries: ${known.size}`,
      );
    }
  }

  if (hard && violations.length) {
    console.error("\nglossary:check FAIL — ungoverned controlled labels (--hard):");
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  "${v.text}" → tip("${v.suggestedId}") or selGloss`);
    }
    process.exit(1);
  }

  if (!reportOnly) {
    const unused = GLOSSARY_ENTRIES.map((e) => e.id).filter((id) => !used.has(id));
    console.log(
      `glossary:check OK — ${known.size} entries · ${used.size} tip keys · controlled violations=${violations.length}` +
        (hard ? " (hard clean)" : violations.length ? " (report only; use --hard to fail)" : ""),
    );
    if (verbose && unused.length) console.log("unused entries:", unused.slice(0, 40).join(", "), unused.length > 40 ? "…" : "");
  } else {
    process.exit(0);
  }
}

main();
