// @see https://bun.com/docs/runtime/utils#bun-sleep
import {
  assertGitHubRateBudget,
  GitHubRateLimitError,
  shouldWaitForRateLimitReset,
  tripGitHubRateLimit,
} from "./github-errors.ts";
import {
  computeWaitMs,
  readGitHubRateLimit,
  type GitHubRateLimitResource,
} from "./github-rate-limit.ts";

/** GitHub rate-limit facade — preflight + budget helpers over the Bun.fetch rate reader. No gh subprocess remains (gh CLI is only the auth-token fallback in github-network.ts). */

export {
  GitHubRateLimitError,
  GitHubCacheMissError,
  GitHubDegradedCacheError,
  isGitHubRateLimitError,
  isGitHubCacheMissError,
  isGitHubApiAbortError,
  serializeGitHubApiError,
  formatRateLimitAbortMessage,
  formatRateLimitRemediation,
  beginGitHubResearchErrorContext,
  finishGitHubResearchErrorContext,
  resetGitHubRateLimitCircuit,
} from "./github-errors.ts";

export { buildGitHubErrorEnrichment } from "./github-error-enrichment.ts";
export { resolveGhRateLimitResource } from "./github-rate-limit.ts";

async function pauseUntilRateLimitReset(
  resetSec: number,
  resource: GitHubRateLimitResource,
): Promise<void> {
  const capped = computeWaitMs(resetSec, Date.now(), resource);
  console.error(
    `[rate-limit] ${resource} waiting ${Math.ceil(capped / 1000)}s (GITHUB_RATE_LIMIT_WAIT=1)`,
  );
  await Bun.sleep(capped);
}

function rateLimitError(
  resetSec: number | null,
  resource: GitHubRateLimitResource,
): GitHubRateLimitError {
  const resetMs = resetSec ? resetSec * 1000 : null;
  return new GitHubRateLimitError(
    `GitHub ${resource} rate limit hit${resetMs ? ` — reset ${new Date(resetMs).toISOString()}` : ""}`,
    { resetAtMs: resetMs, source: `${resource} preflight` },
  );
}

async function ensureResourceBudget(
  resource: GitHubRateLimitResource,
  minRemaining: number,
): Promise<void> {
  const snap = await readGitHubRateLimit(resource);
  if (!snap) return;

  if (snap.remaining >= minRemaining) return;

  if (shouldWaitForRateLimitReset()) {
    await pauseUntilRateLimitReset(snap.reset, resource);
    return;
  }

  tripGitHubRateLimit(snap.reset, `${resource}/preflight`, {
    remaining: snap.remaining,
    limit: snap.limit,
    resource,
  });
  throw rateLimitError(snap.reset, resource);
}

/** Preflight discover + REST — checks core and search buckets (not code_search; see ensureInspectRateBudget). */
export async function ensureGhRateBudget(minRemaining = 3): Promise<void> {
  assertGitHubRateBudget("preflight");
  await ensureResourceBudget("core", minRemaining);
  await ensureResourceBudget("search", minRemaining);
}



