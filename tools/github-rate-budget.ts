#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/utils#bun-main
/**
 * Read GitHub rate-limit buckets + inspect cost estimate — no research run.
 *
 *   bun tools/github-rate-budget.ts
 *   bun tools/github-rate-budget.ts --dimension=price-data --gated=49 --uncached=49
 */
import { parseArgs } from "node:util";
import { loadConfig } from "../src/research/discover.ts";
import {
  estimateCodeSearchCallsPerRepo,
  evaluateInspectRateBudget,
  formatInspectBudgetEstimate,
  parseRateLimitWire,
  type GitHubRateLimitWire,
} from "../src/research/github-rate-limit.ts";

async function fetchRateLimitWire(): Promise<GitHubRateLimitWire | null> {
  const proc = Bun.spawn(["gh", "api", "rate_limit"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : "";
  if (exitCode !== 0) return null;
  try {
    return JSON.parse(stdout) as GitHubRateLimitWire;
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      dimension: { type: "string" },
      gated: { type: "string" },
      uncached: { type: "string" },
    },
    strict: false,
  });

  const config = await loadConfig();
  const codeSearchPerRepo = estimateCodeSearchCallsPerRepo(config);
  const gated = values.gated ? Number(values.gated) : null;
  const uncached = values.uncached ? Number(values.uncached) : gated;

  const wire = await fetchRateLimitWire();
  if (!wire) {
    console.error("failed to read gh api rate_limit — is gh authenticated?");
    process.exit(1);
  }

  const parsed = parseRateLimitWire(wire);
  for (const resource of ["core", "search", "code_search"] as const) {
    const snap = parsed[resource];
    if (!snap) continue;
    const reset = new Date(snap.reset * 1000).toISOString();
    console.log(`${resource.padEnd(12)} ${snap.remaining}/${snap.limit}  reset ${reset}`);
  }

  if (gated !== null && uncached !== null && Number.isFinite(gated) && Number.isFinite(uncached)) {
    console.log("");
    const est = evaluateInspectRateBudget({
      repoCount: gated,
      uncachedRepoCount: uncached,
      codeSearchPerRepo,
      codeSearch: parsed.code_search ?? null,
    });
    console.log(formatInspectBudgetEstimate(est));
    if (!est.canProceed) process.exit(2);
  } else {
    console.log("");
    console.log(
      `Tip: bun tools/github-rate-budget.ts --dimension=${values.dimension ?? "price-data"} --gated=49 --uncached=49`,
    );
    console.log(`code_search per repo (keywords): ${codeSearchPerRepo} queries`);
  }
}
