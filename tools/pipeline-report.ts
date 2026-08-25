#!/usr/bin/env bun
/**
 * `bun run design:pipeline-report` — render the combined frontend build
 * pipeline report (§107) to dist/pipeline.meta.md: every module's size vs
 * budget, largest contributor, growth vs history, and a data-driven
 * enhancement plan per module. Reads the dist metafiles + bundle history
 * (the same data the design:check gate and /api/design/budgets use) —
 * offline, ~10ms.
 */
import { join } from "node:path";
import { DESIGN_MODULE_NAMES, DESIGN_MODULES, buildBudgetHealth } from "../src/lib/design-budget.ts";
import { renderPipelineReport, type PipelineModuleInfo } from "../src/lib/pipeline-report.ts";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "dist", "pipeline.meta.md");

async function main(): Promise<void> {
  const health = await buildBudgetHealth(ROOT);
  const modules: PipelineModuleInfo[] = DESIGN_MODULE_NAMES.map((name) => {
    const h = health[name];
    const spec = DESIGN_MODULES[name];
    return {
      name,
      bytes: h?.bytes ?? null,
      budget: spec.maxBytes,
      largest: h?.largest ?? null,
      largestBudget: spec.maxContributorBytes,
      deltaPct: h?.deltaPct ?? null,
      ok: h?.ok ?? false,
    };
  });
  const md = renderPipelineReport({ generatedAt: new Date().toISOString(), bunVersion: Bun.version, modules });
  await Bun.write(OUT, md);
  const failed = modules.filter((m) => !m.ok).length;
  console.log("design:pipeline-report — wrote " + OUT + " (" + modules.length + " modules, " + (failed === 0 ? "all within budget" : failed + " over budget") + ")");
}

if (import.meta.main) await main();
