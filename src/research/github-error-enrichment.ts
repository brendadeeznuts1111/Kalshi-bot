/** Cache-backed enrichment for self-remediating GitHub error wire payloads. */
import {
  countInspectCacheRepos,
  hasAnySearchCache,
  hasInspectCacheForRepo,
  loadFallbackRunFromDb,
  loadLatestRunFromDb,
} from "./cache.ts";
import { runDimension } from "./dimensions.ts";
import type { CacheFallbackSource, GitHubErrorEnrichment, GitHubRateLimitError } from "./github-errors.ts";
import {
  currentGitHubResearchErrorContext,
  GitHubCacheMissError,
} from "./github-errors.ts";

export type { CacheFallbackSource };

export function probeCrossDimensionCacheFallback(err: GitHubRateLimitError): {
  available: boolean;
  source?: CacheFallbackSource;
  inspectCacheRepoCount?: number;
} {
  if (err instanceof GitHubCacheMissError) {
    switch (err.cacheKind) {
      case "inspect": {
        if (hasInspectCacheForRepo(err.cacheKey)) {
          return { available: true, source: "inspect_cache", inspectCacheRepoCount: 1 };
        }
        const n = countInspectCacheRepos();
        if (n > 0) return { available: true, source: "inspect_cache", inspectCacheRepoCount: n };
        return { available: false };
      }
      case "search":
        if (hasAnySearchCache()) return { available: true, source: "search_cache" };
        return { available: false };
      case "api": {
        const n = countInspectCacheRepos();
        if (n > 0) return { available: true, source: "inspect_cache", inspectCacheRepoCount: n };
        if (hasAnySearchCache()) return { available: true, source: "search_cache" };
        return { available: false };
      }
    }
  }

  const inspectCount = countInspectCacheRepos();
  if (inspectCount > 0) {
    return { available: true, source: "inspect_cache", inspectCacheRepoCount: inspectCount };
  }
  if (hasAnySearchCache()) return { available: true, source: "search_cache" };
  return { available: false };
}

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

  const cacheProbe = probeCrossDimensionCacheFallback(err);
  const cacheFallbackSource: CacheFallbackSource | undefined =
    overrides.cacheFallbackSource ?? (staleDataRunId ? "run" : cacheProbe.source);
  const inspectCacheRepoCount =
    overrides.inspectCacheRepoCount ?? cacheProbe.inspectCacheRepoCount;

  const cachedDataAvailable =
    overrides.cachedDataAvailable ??
    Boolean(staleDataRunId || cacheProbe.available);

  return {
    ...ctx,
    staleDataRunId,
    staleDataAgeMs,
    staleDataSourceDimension,
    cachedDataAvailable,
    cacheFallbackSource,
    inspectCacheRepoCount,
    blockedOperations: overrides.blockedOperations,
  };
}
