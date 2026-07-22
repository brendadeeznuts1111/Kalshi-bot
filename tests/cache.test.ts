// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { cacheHash, isProductionRunId, isEligibleProductionRun, listRunSummaries, saveRun, loadRunFromDb, searchCachedPayloads, withCache, loadInspectCache, loadLatestInspectCache, saveInspectCache } from "../src/research/cache.ts";
import { GitHubCacheMissError, resetGitHubRateLimitCircuit, tripGitHubRateLimit } from "../src/research/github-errors.ts";
import type { InspectionSignals } from "../src/research/types.ts";

describe("isProductionRunId", () => {
  test("accepts ISO pipeline run ids", () => {
    expect(isProductionRunId("2026-07-22T04-59-00-818Z")).toBe(true);
  });

  test("rejects test fixture ids", () => {
    expect(isProductionRunId("serve-test-run")).toBe(false);
    expect(isProductionRunId("2099-06-01T00-00-00-000Z")).toBe(false);
    expect(isProductionRunId("2099-01-02T00-00-00-000Z")).toBe(false);
  });

  test("isEligibleProductionRun rejects future-dated fixtures", () => {
    expect(
      isEligibleProductionRun({
        runId: "2026-12-30T00-00-00-000Z",
        generatedAt: "2026-12-30T00:00:00.000Z",
      } as never),
    ).toBe(false);
    expect(
      isEligibleProductionRun({
        runId: "2026-07-22T04-59-00-818Z",
        generatedAt: "2026-07-22T04:59:00.818Z",
      } as never),
    ).toBe(true);
  });
});

describe("cacheHash", () => {
  test("is stable for same repo+endpoint+pushedAt", () => {
    const a = cacheHash("o/r", "readme", "2026-01-01T00:00:00Z");
    const b = cacheHash("o/r", "readme", "2026-01-01T00:00:00Z");
    expect(a).toBe(b);
  });

  test("changes when pushedAt changes", () => {
    const a = cacheHash("o/r", "readme", "2026-01-01T00:00:00Z");
    const b = cacheHash("o/r", "readme", "2026-02-01T00:00:00Z");
    expect(a).not.toBe(b);
  });
});

describe("withCache + runs", () => {
  afterEach(() => {
    resetGitHubRateLimitCircuit();
  });

  test("stores and retrieves API payload", async () => {
    const repo = `test/repo-${Date.now()}`;
    let calls = 0;
    const value = await withCache(repo, "2026-01-01T00:00:00Z", "test_endpoint", async () => {
      calls++;
      return { ok: true };
    });
    expect(value).toEqual({ ok: true });
    expect(calls).toBe(1);

    const again = await withCache(repo, "2026-01-01T00:00:00Z", "test_endpoint", async () => {
      calls++;
      return { ok: false };
    });
    expect(again).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  test("searchCachedReadmes finds substring in readme endpoint", async () => {
    await withCache("search/repo", "2026-01-02T00:00:00Z", "readme", async () => "mentions websocket feed");
    const hits = searchCachedPayloads("readme", "websocket");
    expect(hits.some((h) => h.repo === "search/repo")).toBe(true);
  });

  test("inspect cache round-trips full InspectionSignals", () => {
    const repo = `inspect/cache-${Date.now()}`;
    const pushedAt = "2026-03-01T12:00:00Z";
    const signals: InspectionSignals = {
      readmeLength: 100,
      hasSetupSection: true,
      hasStrategySection: false,
      authHits: [],
      orderHits: [],
      usesOfficialSdk: false,
      hasAuthInCode: true,
      hasV2Api: true,
      hasRsaPss: false,
      hasLiveOrderPath: false,
      hasDryRunDefault: true,
      hasAuthFreshness: true,
      hasCentsPriceBounds: false,
      hasTests: true,
      hasCi: false,
      languages: { TypeScript: 100 },
      primaryLanguage: "TypeScript",
      lastDefaultBranchCommitAt: "2026-02-01T00:00:00Z",
      strategyTags: ["tracking"],
      isSdkOnly: false,
      riskKeywordHits: [],
    };
    expect(loadInspectCache(repo, pushedAt)).toBeNull();
    saveInspectCache(repo, pushedAt, signals);
    expect(loadInspectCache(repo, pushedAt)).toEqual(signals);
    expect(loadLatestInspectCache(repo)).toEqual(signals);
  });

  test("withCache throws GitHubCacheMissError when circuit tripped and no api_cache row", async () => {
    tripGitHubRateLimit(Math.ceil(Date.now() / 1000) + 120, "test");
    const repo = `cache-miss-${Date.now()}`;
    await expect(
      withCache(repo, "2026-01-01T00:00:00Z", "readme", async () => "should not run"),
    ).rejects.toBeInstanceOf(GitHubCacheMissError);
  });

  test("withCache serves stale api_cache when circuit tripped", async () => {
    const repo = `cache-stale-${Date.now()}`;
    await withCache(repo, "2026-01-01T00:00:00Z", "readme", async () => "fresh readme");
    tripGitHubRateLimit(Math.ceil(Date.now() / 1000) + 120, "test");
    const value = await withCache(repo, "2026-01-01T00:00:00Z", "readme", async () => "should not run");
    expect(value).toBe("fresh readme");
  });

  test("saveRun and loadRunFromDb round-trip", () => {
    const payload = {
      runId: "test-run-id",
      generatedAt: "2026-01-01T00:00:00Z",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    };
    saveRun("test-run-id", "2026-01-01T00:00:00Z", payload);
    const loaded = loadRunFromDb("test-run-id");
    expect(loaded?.runId).toBe("test-run-id");
  });

  test("listRunSummaries returns stats from saved runs", () => {
    saveRun("summary-run", "2099-06-01T00:00:00.000Z", {
      runId: "summary-run",
      generatedAt: "2099-06-01T00:00:00.000Z",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 9, gated: 4, inspected: 4, shortlist: 2 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    const hit = listRunSummaries().find((s) => s.runId === "summary-run");
    expect(hit?.discovered).toBe(9);
    expect(hit?.shortlist).toBe(2);
  });
});
