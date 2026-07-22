/** Cache-backed enrichment for self-remediating GitHub error wire payloads. */
import { loadLatestRunFromDb } from "./cache.ts";
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
  const staleDataRunId = overrides.staleDataRunId ?? latestRun?.runId;
  const staleDataAgeMs =
    overrides.staleDataAgeMs ??
    (latestRun ? Date.now() - Date.parse(latestRun.generatedAt) : null);

  return {
    ...ctx,
    staleDataRunId,
    staleDataAgeMs,
    cachedDataAvailable: overrides.cachedDataAvailable ?? Boolean(staleDataRunId),
    blockedOperations: overrides.blockedOperations,
  };
}
