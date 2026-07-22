// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { saveRun, saveInspectCache } from "../src/research/cache.ts";
import type { InspectionSignals } from "../src/research/types.ts";
import { buildGitHubErrorEnrichment, probeCrossDimensionCacheFallback } from "../src/research/github-error-enrichment.ts";
import { withTempCache } from "./temp-cache.ts";
import {
  assertGitHubRateBudget,
  GitHubCacheMissError,
  GitHubRateLimitError,
  isGitHubApiAbortError,
  isGitHubCacheMissError,
  isGitHubRateLimitError,
  isGitHubRateLimitTripped,
  resetGitHubRateLimitCircuit,
  serializeGitHubApiError,
  formatRateLimitRemediation,
  beginGitHubResearchErrorContext,
  finishGitHubResearchErrorContext,
  throwCacheMissIfTripped,
  tripGitHubRateLimit,
} from "../src/research/github-errors.ts";
import { freshTestGeneratedAt } from "./fixtures.ts";

const CROSS_DIM_RUN_ID = "2026-07-22T12-00-00-001Z";

describe("github errors", () => {
  afterEach(() => {
    resetGitHubRateLimitCircuit();
  });

  test("trips and blocks subsequent calls", () => {
    const resetSec = Math.ceil(Date.now() / 1000) + 120;
    tripGitHubRateLimit(resetSec, "test");
    expect(isGitHubRateLimitTripped()).toBe(true);
    expect(() => assertGitHubRateBudget("inspect")).toThrow(GitHubRateLimitError);
  });

  test("throwCacheMissIfTripped throws GitHubCacheMissError", () => {
    tripGitHubRateLimit(Math.ceil(Date.now() / 1000) + 120, "search");
    expect(() => throwCacheMissIfTripped("search", "kalshi bot")).toThrow(GitHubCacheMissError);
  });

  test("clears trip after reset time passes", () => {
    tripGitHubRateLimit(Math.floor(Date.now() / 1000) - 1, "test");
    expect(isGitHubRateLimitTripped()).toBe(false);
    expect(() => assertGitHubRateBudget("discover")).not.toThrow();
  });

  test("type guards distinguish cache miss from rate limit", () => {
    const miss = new GitHubCacheMissError("no cache", {
      cacheKind: "api",
      cacheKey: "o/r:readme",
    });
    expect(isGitHubCacheMissError(miss)).toBe(true);
    expect(isGitHubRateLimitError(miss)).toBe(true);
    expect(isGitHubApiAbortError(miss)).toBe(true);
  });

  test("GitHubRateLimitError exposes reset ISO", () => {
    const resetMs = Date.now() + 60_000;
    const err = new GitHubRateLimitError("limited", { resetAtMs: resetMs, source: "gh api" });
    expect(err.resetIso()).toBe(new Date(resetMs).toISOString());
  });

  test("serializeGitHubApiError emits self-remediating wire shape", () => {
    beginGitHubResearchErrorContext({ dimension: "price-data", minStars: 1, minForks: 0 });
    const resetMs = Date.now() + 487_000;
    tripGitHubRateLimit(Math.ceil(resetMs / 1000), "search/repositories", {
      remaining: 0,
      limit: 30,
      resource: "search",
    });
    const err = new GitHubCacheMissError(
      "GitHub search rate limit exceeded and no cached result available for query",
      {
        resetAtMs: resetMs,
        source: "search/repositories",
        cacheKind: "search",
        cacheKey: "kalshi bot stars:>=5 pushed:>=2024-01-01",
      },
    );
    const wire = serializeGitHubApiError(err, {
      staleDataRunId: "2026-07-21T12-00-00-000Z",
      staleDataAgeMs: 3600_000,
      cachedDataAvailable: true,
    });
    finishGitHubResearchErrorContext();

    expect(wire.code).toBe("cache_miss");
    expect(wire.retryAfterSeconds).toBeGreaterThan(400);
    expect(wire.remediation.action).toBe("use_cached_run");
    expect(wire.remediation.command).toContain("--run=2026-07-21T12-00-00-000Z");
    expect(wire.impact.dimension).toBe("price-data");
    expect(wire.impact.blockedOperations).toEqual(["discover"]);
    expect(wire.circuit.tripped).toBe(true);
    expect(wire.circuit.limit).toBe(30);
  });

  test("formatRateLimitRemediation prints actionable CLI output", () => {
    tripGitHubRateLimit(Math.ceil((Date.now() + 480_000) / 1000), "search/repositories", {
      remaining: 0,
      limit: 30,
      resource: "search",
    });
    const err = new GitHubCacheMissError("blocked", {
      resetAtMs: Date.now() + 480_000,
      source: "search/repositories",
      cacheKind: "search",
      cacheKey: "kalshi",
      context: { dimension: "tracking" },
    });
    const text = formatRateLimitRemediation(err, {
      staleDataRunId: "2026-07-21T12-00-00-000Z",
      cachedDataAvailable: true,
    });
    expect(text).toContain("tracking blocked");
    expect(text).toContain("bun run agent patterns");
    expect(text).toContain("Circuit tripped");
  });

  test("serializeGitHubApiError names source dimension for cross-dimension cached run", () => {
    beginGitHubResearchErrorContext({ dimension: "price-data", minStars: 1, minForks: 0 });
    tripGitHubRateLimit(Math.ceil((Date.now() + 480_000) / 1000), "search/repositories", {
      remaining: 0,
      limit: 30,
      resource: "search",
    });
    const err = new GitHubCacheMissError("blocked", {
      resetAtMs: Date.now() + 480_000,
      source: "search/repositories",
      cacheKind: "search",
      cacheKey: "kalshi",
    });
    const wire = serializeGitHubApiError(err, {
      staleDataRunId: CROSS_DIM_RUN_ID,
      staleDataSourceDimension: "market-making",
      staleDataAgeMs: 7200_000,
      cachedDataAvailable: true,
    });
    finishGitHubResearchErrorContext();

    expect(wire.remediation.action).toBe("use_cached_run");
    expect(wire.remediation.command).toContain("--dimension=market-making");
    expect(wire.remediation.command).toContain(`--run=${CROSS_DIM_RUN_ID}`);
    expect(wire.remediation.alternative).toContain("market-making dimension");
    expect(wire.impact.staleDataSourceDimension).toBe("market-making");
  });

  test("formatRateLimitRemediation notes cross-dimension prior run", () => {
    tripGitHubRateLimit(Math.ceil((Date.now() + 480_000) / 1000), "search/repositories", {
      remaining: 0,
      limit: 30,
      resource: "search",
    });
    const err = new GitHubCacheMissError("blocked", {
      resetAtMs: Date.now() + 480_000,
      source: "search/repositories",
      cacheKind: "search",
      cacheKey: "kalshi",
      context: { dimension: "price-data" },
    });
    const text = formatRateLimitRemediation(err, {
      staleDataRunId: CROSS_DIM_RUN_ID,
      staleDataSourceDimension: "market-making",
      staleDataAgeMs: 7200_000,
      cachedDataAvailable: true,
    });
    expect(text).toContain("market-making dimension");
    expect(text).toContain("from market-making dimension");
    expect(text).toContain(CROSS_DIM_RUN_ID);
  });

  test("probeCrossDimensionCacheFallback detects inspect_cache without prior run", async () => {
    await withTempCache(async () => {
      const repo = `enrich-inspect-${Date.now()}`;
      const signals: InspectionSignals = {
        readmeLength: 1,
        hasSetupSection: false,
        hasStrategySection: false,
        authHits: [],
        orderHits: [],
        usesOfficialSdk: false,
        hasAuthInCode: false,
        hasV2Api: false,
        hasRsaPss: false,
        hasLiveOrderPath: false,
        hasDryRunDefault: false,
        hasAuthFreshness: false,
        hasCentsPriceBounds: false,
        hasTests: false,
        hasCi: false,
        languages: {},
        primaryLanguage: null,
        lastDefaultBranchCommitAt: null,
        strategyTags: [],
        isSdkOnly: false,
        riskKeywordHits: [],
        hasFeeAware: false,
        feeAwareKeywordHits: [],
      };
      saveInspectCache(repo, "2026-01-01T00:00:00Z", signals);

      const err = new GitHubCacheMissError("no inspect row for new repo", {
        cacheKind: "inspect",
        cacheKey: "other/no-cache",
      });
      const probe = probeCrossDimensionCacheFallback(err);
      expect(probe.available).toBe(true);
      expect(probe.source).toBe("inspect_cache");
      expect(probe.inspectCacheRepoCount).toBeGreaterThan(0);

      beginGitHubResearchErrorContext({ dimension: "price-data" });
      const wire = serializeGitHubApiError(err, {
        dimension: "price-data",
        cachedDataAvailable: true,
        cacheFallbackSource: "inspect_cache",
        inspectCacheRepoCount: probe.inspectCacheRepoCount,
      });
      finishGitHubResearchErrorContext();

      expect(wire.remediation.action).toBe("use_cached_run");
      expect(wire.remediation.alternative).toContain("Cross-dimension inspect cache");
      expect(wire.impact.cacheFallbackSource).toBe("inspect_cache");
    });
  });

  test("buildGitHubErrorEnrichment falls back to cross-dimension production run", async () => {
    await withTempCache(async () => {
      const at = freshTestGeneratedAt();
      saveRun(CROSS_DIM_RUN_ID, at, {
        runId: CROSS_DIM_RUN_ID,
        generatedAt: at,
        dimension: "market-making",
        kind: "production",
        config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
        stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 0 },
        candidates: [],
        gated: [],
        scored: [],
        shortlist: [],
        excludedSdkOnly: [],
      });

      beginGitHubResearchErrorContext({ dimension: "zzz-cross-dim-test" });
      const err = new GitHubCacheMissError("blocked", {
        cacheKind: "search",
        cacheKey: "kalshi",
      });
      const enrichment = buildGitHubErrorEnrichment(err);
      finishGitHubResearchErrorContext();

      expect(enrichment.staleDataRunId).toBe(CROSS_DIM_RUN_ID);
      expect(enrichment.staleDataSourceDimension).toBe("market-making");
      expect(enrichment.cachedDataAvailable).toBe(true);
    });
  });
});
