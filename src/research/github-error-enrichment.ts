/** Cache-backed enrichment for self-remediating GitHub error wire payloads. */
import { loadFallbackRunFromDb, loadLatestRunFromDb } from "./cache.ts";
import { runDimension } from "./dimensions.ts";
import type { GitHubErrorEnrichment, GitHubRateLimitError } from "./github-errors.ts";
import { currentGitHubResearchErrorContext } from "./github-errors.ts";

export function buildGitHubErrorEnrichment(
  err: GitHubRateLimitError,
  overrides: GitHubErrorEnrichment = {},
): GitHubErrorEnrichment {
  const ctx = {
    ...currentGitHubResearchErrorContext(),
    ...err.context,
    ...overrides,
  };

  const dimension = ctx.dimension;
  const latestRun = dimension ? loadLatestRunFromDb({ dimension }) : null;
  const fallbackRun =
    dimension && !latestRun && !overrides.staleDataRunId
      ? loadFallbackRunFromDb({ dimension })
      : null;
  const effectiveRun = latestRun ?? fallbackRun;
  const staleDataRunId = overrides.staleDataRunId ?? effectiveRun?.runId;
  const staleDataAgeMs =
    overrides.staleDataAgeMs ??
    (effectiveRun ? Date.now() - Date.parse(effectiveRun.generatedAt) : null);
  const staleDataSourceDimension =
    overrides.staleDataSourceDimension ??
    (fallbackRun && !latestRun ? runDimension(fallbackRun) : undefined);

  return {
    ...ctx,
    staleDataRunId,
    staleDataAgeMs,
    staleDataSourceDimension,
    cachedDataAvailable: overrides.cachedDataAvailable ?? Boolean(staleDataRunId),
    blockedOperations: overrides.blockedOperations,
  };
}
