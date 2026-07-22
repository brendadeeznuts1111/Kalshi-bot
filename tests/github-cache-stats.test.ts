// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import {
  beginResearchCacheStats,
  finishResearchCacheStats,
  formatCacheStatsSummary,
  hasDegradedCacheUsage,
  recordCacheStat,
} from "../src/research/github-cache-stats.ts";
import { GitHubCacheMissError, serializeGitHubApiError } from "../src/research/github-errors.ts";

describe("github-cache-stats", () => {
  afterEach(() => {
    finishResearchCacheStats();
  });

  test("records events and formats summary", () => {
    beginResearchCacheStats();
    recordCacheStat("searchEtag");
    recordCacheStat("searchDegraded");
    recordCacheStat("inspectExact");
    const stats = finishResearchCacheStats()!;
    expect(formatCacheStatsSummary(stats)).toContain("search ETag 1");
    expect(formatCacheStatsSummary(stats)).toContain("search stale 1");
    expect(hasDegradedCacheUsage(stats)).toBe(true);
  });
});

describe("serializeGitHubApiError", () => {
  test("maps cache miss to wire code with remediation", () => {
    const wire = serializeGitHubApiError(
      new GitHubCacheMissError("no cache", {
        cacheKind: "search",
        cacheKey: "kalshi bot",
        resetAtMs: Date.now() + 60_000,
        source: "search/repositories",
        context: { dimension: "market-making", minStars: 5 },
      }),
    );
    expect(wire.code).toBe("cache_miss");
    expect(wire.cacheKind).toBe("search");
    expect(wire.resetAt).not.toBeNull();
    expect(wire.remediation.action).toBe("retry_after_reset");
    expect(wire.remediation.command).toContain("--dimension=market-making");
    expect(wire.impact.blockedOperations).toEqual(["discover"]);
  });
});
