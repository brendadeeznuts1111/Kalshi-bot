#!/usr/bin/env bun
/**
 * research:resume — run a research dimension to COMPLETION across
 * code_search windows, automatically.
 *
 * The pipeline's WAIT=1 multi-wave can give up when the circuit trips;
 * scoped inspect results persist in api_cache (repo+pushed_at), so each
 * attempt only fetches the REMAINING repos — the loop converges (§151).
 *
 *   bun run research:resume -- --dimension=sports-nba [-- --min-stars=5]
 *
 * Exits 0 on a completed run; 2 after MAX_ATTEMPTS without completion.
 */
import { $ } from "bun";
import { readGitHubRateLimit } from "../src/research/github-rate-limit.ts";
import { parseArgs } from "node:util";

const MAX_ATTEMPTS = Number(Bun.env.RESEARCH_RESUME_MAX_ATTEMPTS ?? 8);
const RETRY_WAIT_MS = Number(Bun.env.RESEARCH_RESUME_RETRY_WAIT_MS ?? 75_000);

const { values: rv, positionals: rp } = parseArgs({ args: Bun.argv.slice(2), options: { dimension: { type: 'string' } }, strict: false, allowPositionals: true });
const dimension = typeof rv.dimension === 'string' ? rv.dimension : "all";
const args = rp;

async function runResearch(): Promise<{ ok: boolean; output: string }> {
  // Bun.$ (repo doctrine); quiet() would DISCARD the output we classify.
  const res = await $`bun run research -- ${args}`.env({ ...Bun.env, GITHUB_RATE_LIMIT_WAIT: "1" }).nothrow();
  return { ok: res.exitCode === 0, output: (String(res.stdout ?? "") + "\n" + String(res.stderr ?? "")).trim() };
}
function isRateLimitBlocked(output: string): boolean {
  return /rate limit|code_search|blocked/i.test(output);
}

console.log("research:resume — dimension=" + dimension + " · max " + MAX_ATTEMPTS + " attempts");
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  console.log("[" + attempt + "/" + MAX_ATTEMPTS + "] running bun run research...");
  const { ok, output } = await runResearch();
  const tail = output.split("\n").slice(-8).join("\n");
  console.log(tail);
  if (ok) {
    console.log("research:resume — COMPLETED (attempt " + attempt + ")");
    process.exit(0);
  }
  if (!isRateLimitBlocked(output)) {
    console.error("research:resume — failed for a non-rate-limit reason; not retrying");
    process.exit(2);
  }
  if (attempt === MAX_ATTEMPTS) break;
  const budget = await readGitHubRateLimit("code_search");
  const waitMs = budget && budget.reset > 0 ? Math.max(RETRY_WAIT_MS, budget.reset * 1000 - Date.now() + 5_000) : RETRY_WAIT_MS;
  console.log("[" + attempt + "] rate-limit blocked — waiting " + Math.round(waitMs / 1000) + "s for the next window");
  await Bun.sleep(waitMs);
}
console.error("research:resume — gave up after " + MAX_ATTEMPTS + " attempts (dimension=" + dimension + ")");
process.exit(2);
