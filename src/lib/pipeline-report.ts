/**
 * pipeline-report — the 'mtafile of mtafiles' (§107): a combined review
 * document for the frontend build pipeline. Reads the per-module budget
 * health (design-budget) and renders a markdown report with a summary
 * table + a data-driven ENHANCEMENT PLAN per module (derived from
 * budget/contributor/growth status — no hardcoded prose). Pure +
 * unit-testable.
 */
import { MAX_GROWTH_PCT, WARN_GROWTH_PCT } from "./design-budget.ts";

export interface PipelineModuleInfo {
  name: string;
  bytes: number | null;
  budget: number;
  largest: number | null;
  largestBudget: number;
  deltaPct: number | null;
  ok: boolean;
}

export interface PipelineReportInput {
  generatedAt: string;
  bunVersion: string;
  modules: PipelineModuleInfo[];
}

/** Monolith: the largest contributor is >= 90% of the bundle. */
export const MONOLITH_RATIO = 0.9;

/**
 * Data-driven enhancement notes for one module. Order matters: the most
 * actionable finding comes first.
 */
export function moduleEnhancementNotes(info: PipelineModuleInfo): string[] {
  const notes: string[] = [];
  if (info.bytes === null) {
    notes.push("metafile missing — run `bun run design:build` to seed");
    return notes;
  }
  if (!info.ok) notes.push("OVER BUDGET (" + (info.bytes / 1024).toFixed(1) + " KB / " + (info.budget / 1024).toFixed(0) + " KB) — reduce size or raise the budget only after review");
  if (info.largest !== null && info.largest >= info.bytes * MONOLITH_RATIO)
    notes.push("monolith: the largest contributor is " + ((info.largest / info.bytes) * 100).toFixed(1) + "% of the bundle — consider chunking it out");
  if (info.largest !== null && info.largest > info.largestBudget)
    notes.push("largest contributor over its budget (" + (info.largest / 1024).toFixed(1) + " KB / " + (info.largestBudget / 1024).toFixed(0) + " KB)");
  if (info.deltaPct !== null && info.deltaPct > WARN_GROWTH_PCT)
    notes.push("grew " + info.deltaPct.toFixed(1) + "% vs the previous build (warn > " + WARN_GROWTH_PCT + "%, fail > " + MAX_GROWTH_PCT + "%)");
  if (notes.length === 0)
    notes.push("within budget — largest contributor " + (info.largest !== null ? ((info.largest / info.bytes) * 100).toFixed(1) + "%" : "?") + ", expected core weight");
  return notes;
}

export function renderPipelineReport(input: PipelineReportInput): string {
  const rows: string[] = [];
  const push = (s = "") => rows.push(s);
  push("# Frontend Build Pipeline Report");
  push();
  push("- Generated: " + input.generatedAt);
  push("- Bun: " + input.bunVersion);
  push("- Modules: " + input.modules.length);
  push();
  push("## Module summary");
  push();
  push("| Module | Size | Budget | Largest | Growth | Status |");
  push("|---|---|---|---|---|---|");
  for (const m of input.modules) {
    const size = m.bytes !== null ? (m.bytes / 1024).toFixed(2) + " KB" : "missing";
    const largest = m.largest !== null ? (m.largest / 1024).toFixed(2) + " KB" : "?";
    const growth = m.deltaPct !== null ? (m.deltaPct >= 0 ? "+" : "") + m.deltaPct.toFixed(1) + "%" : "—";
    push("| " + [m.name, size, (m.budget / 1024).toFixed(0) + " KB", largest, growth, m.ok ? "ok" : "FAIL"].join(" | ") + " |");
  }
  push();
  push("## Enhancement plan (per module)");
  push();
  for (const m of input.modules) {
    push("### " + m.name);
    push();
    const notes = moduleEnhancementNotes(m);
    if (notes.length === 0) push("- none");
    for (const n of notes) push("- " + n);
    push();
  }
  const failed = input.modules.filter((m) => !m.ok);
  push("## Gate");
  push();
  push("**" + (failed.length === 0 ? "PASS" : "FAIL (" + failed.length + " module(s) over budget)") + "**");
  return rows.join("\n") + "\n";
}
