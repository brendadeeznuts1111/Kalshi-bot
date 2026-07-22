// @see https://bun.com/docs/test/index#run-tests
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  backfillDiscoverGates,
  cacheHash,
  isFixtureRun,
  isProductionRunId,
  isEligibleProductionRun,
  looksLikeSyntheticFixtureRun,
  listRunSummaries,
  loadLatestProductionRunAnyDimension,
  purgeIneligibleRuns,
  resetCacheDbConnection,
  saveRun,
  loadRunFromDb,
  loadLatestRunFromDb,
  loadResearchRun,
  runIdTimestampMs,
  searchCachedPayloads,
  withCache,
  loadInspectCache,
  loadLatestInspectCache,
  saveInspectCache,
} from "../src/research/cache.ts";
import { GitHubCacheMissError, resetGitHubRateLimitCircuit, tripGitHubRateLimit } from "../src/research/github-errors.ts";
import type { InspectionSignals } from "../src/research/types.ts";
import { freshTestGeneratedAt, mintTestProductionRunId } from "./fixtures.ts";
import { enterTempCache, exitTempCache } from "./temp-cache.ts";
import { tempSqlitePath, unlinkSqlite } from "./tmp-db.ts";

describe("isProductionRunId", () => {
  test("accepts ISO pipeline run ids", () => {
    expect(isProductionRunId("2026-07-22T04-59-00-818Z")).toBe(true);
    expect(runIdTimestampMs("2026-07-22T04-59-00-818Z")).toBe(Date.parse("2026-07-22T04:59:00.818Z"));
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
        runId: "2026-12-31T23-59-59-000Z",
        generatedAt: new Date().toISOString(),
      } as never),
    ).toBe(false);
    const recentId = mintTestProductionRunId();
    expect(
      isEligibleProductionRun({
        runId: recentId,
        generatedAt: new Date().toISOString(),
      } as never),
    ).toBe(true);
  });

  test("isFixtureRun ignores forged kind:production on far-future run ids", () => {
    const forged = {
      runId: "2026-12-31T23-59-59-000Z",
      generatedAt: new Date().toISOString(),
      kind: "production" as const,
    };
    expect(isEligibleProductionRun(forged as never)).toBe(false);
    expect(isFixtureRun(forged as never)).toBe(true);
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
  beforeAll(async () => {
    await enterTempCache();
  });
  afterAll(() => {
    exitTempCache();
  });
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
      hasFeeAware: false,
      feeAwareKeywordHits: [],
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

  test("listRunSummaries excludes fixture runs", () => {
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
    expect(hit).toBeUndefined();
  });

  test("listRunSummaries over-fetches past future-dated fixtures", () => {
    const base = {
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [] as never[],
      gated: [] as never[],
      scored: [] as never[],
      shortlist: [] as never[],
      excludedSdkOnly: [] as never[],
    };
    for (let i = 0; i < 25; i++) {
      const id = `fixture-starvation-${i}`;
      saveRun(id, "2099-06-01T00:00:00.000Z", {
        ...base,
        runId: id,
        generatedAt: "2099-06-01T00:00:00.000Z",
        kind: "fixture" as const,
        dimension: "all",
      });
    }
    const prodId = mintTestProductionRunId();
    const at = freshTestGeneratedAt();
    saveRun(prodId, at, {
      ...base,
      runId: prodId,
      generatedAt: at,
      kind: "production",
      dimension: "all",
    });
    const summaries = listRunSummaries(5);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries.some((s) => s.runId === prodId)).toBe(true);
  });

  test("loadLatestProductionRunAnyDimension survives many future fixtures", () => {
    const base = {
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [] as never[],
      gated: [] as never[],
      scored: [] as never[],
      shortlist: [] as never[],
      excludedSdkOnly: [] as never[],
    };
    for (let i = 0; i < 60; i++) {
      const id = `latest-starvation-${i}`;
      saveRun(id, "2099-07-01T00:00:00.000Z", {
        ...base,
        runId: id,
        generatedAt: "2099-07-01T00:00:00.000Z",
        kind: "fixture" as const,
        dimension: "all",
      });
    }
    const prodId = mintTestProductionRunId();
    const at = freshTestGeneratedAt();
    saveRun(prodId, at, {
      ...base,
      runId: prodId,
      generatedAt: at,
      kind: "production",
      dimension: "all",
    });
    expect(loadLatestProductionRunAnyDimension()?.runId).toBe(prodId);
    expect(loadLatestRunFromDb({ dimension: "all" })?.runId).toBe(prodId);
  });

  test("saveRun rewrites forged kind:production to fixture when ineligible", () => {
    const at = freshTestGeneratedAt();
    saveRun("2026-12-31T23-59-59-000Z", at, {
      runId: "2026-12-31T23-59-59-000Z",
      generatedAt: at,
      kind: "production",
      dimension: "all",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    const loaded = loadRunFromDb("2026-12-31T23-59-59-000Z");
    expect(loaded?.kind).toBe("fixture");
    expect(listRunSummaries().some((s) => s.runId === "2026-12-31T23-59-59-000Z")).toBe(false);
  });

  test("saveRun stamps discoverGate when missing", () => {
    const at = freshTestGeneratedAt();
    const id = mintTestProductionRunId();
    saveRun(id, at, {
      runId: id,
      generatedAt: at,
      kind: "production",
      source: "pipeline",
      dimension: "all",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    const loaded = loadRunFromDb(id);
    expect(loaded?.config.discoverGate).toEqual({
      minStars: 0,
      minForks: 0,
      maxAgeMonths: 18,
    });
  });

  test("backfillDiscoverGates stamps previously bare configs", () => {
    // :memory: cannot be reopened from a second connection — use an on-disk temp DB.
    const path = tempSqlitePath("backfill-dg");
    const prev = Bun.env.RESEARCH_CACHE_DB;
    Bun.env.RESEARCH_CACHE_DB = path;
    resetCacheDbConnection();
    try {
      const at = freshTestGeneratedAt();
      const id = mintTestProductionRunId();
      saveRun(id, at, {
        runId: id,
        generatedAt: at,
        kind: "production",
        source: "pipeline",
        dimension: "all",
        config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
        stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
        candidates: [],
        gated: [],
        scored: [],
        shortlist: [],
        excludedSdkOnly: [],
      });
      resetCacheDbConnection();
      const db = new Database(path);
      const row = db.query("SELECT payload FROM runs WHERE run_id = ?").get(id) as {
        payload: string;
      };
      const parsed = JSON.parse(row.payload) as {
        config: { discoverGate?: unknown };
      };
      delete parsed.config.discoverGate;
      db.query("UPDATE runs SET payload = ? WHERE run_id = ?").run(JSON.stringify(parsed), id);
      db.close();
      resetCacheDbConnection();

      expect(backfillDiscoverGates()).toEqual([id]);
      expect(loadRunFromDb(id)?.config.discoverGate).toEqual({
        minStars: 0,
        minForks: 0,
        maxAgeMonths: 18,
      });
    } finally {
      resetCacheDbConnection();
      if (prev === undefined) delete Bun.env.RESEARCH_CACHE_DB;
      else Bun.env.RESEARCH_CACHE_DB = prev;
      resetCacheDbConnection();
      unlinkSqlite(path);
    }
  });

  test("saveRun forces payload.runId to match the row key", () => {
    const at = freshTestGeneratedAt();
    const key = mintTestProductionRunId();
    saveRun(key, at, {
      runId: "2026-07-21T12-00-00-000Z",
      generatedAt: at,
      kind: "production",
      source: "pipeline",
      dimension: "all",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    const loaded = loadRunFromDb(key);
    expect(loaded?.runId).toBe(key);
    expect(loadRunFromDb("2026-07-21T12-00-00-000Z")).toBeNull();
  });

  test("source:test is treated as fixture even with eligible production id", () => {
    const at = freshTestGeneratedAt();
    const id = mintTestProductionRunId();
    saveRun(id, at, {
      runId: id,
      generatedAt: at,
      kind: "production",
      source: "test",
      dimension: "all",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    const loaded = loadRunFromDb(id);
    expect(loaded?.kind).toBe("fixture");
    expect(isFixtureRun(loaded!)).toBe(true);
    expect(loadLatestProductionRunAnyDimension()?.runId).not.toBe(id);
  });

  test("saveRun forces fixture for unmarked production-shaped synthetic shortlist", () => {
    const at = freshTestGeneratedAt();
    const synthId = mintTestProductionRunId();
    const realId = mintTestProductionRunId(Date.now() - 1_000);
    const syntheticRepo = {
      fullName: "OctagonAI/kalshi-trading-bot-cli",
      owner: "OctagonAI",
      name: "kalshi-trading-bot-cli",
      htmlUrl: "https://github.com/OctagonAI/kalshi-trading-bot-cli",
      description: "test",
      stars: 100,
      forks: 10,
      pushedAt: at,
      archived: false,
      topics: [] as string[],
      defaultBranch: "main",
      license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
    };
    const scored = [
      {
        repo: syntheticRepo,
        signals: {
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
          hasFeeAware: false,
          feeAwareKeywordHits: [],
          hasTests: false,
          hasCi: false,
          languages: {},
          primaryLanguage: null,
          lastDefaultBranchCommitAt: null,
          strategyTags: [],
          isSdkOnly: false,
          riskKeywordHits: [],
        },
        score: {
          authApi: 0,
          orderRealism: 0,
          testsCi: 0,
          docsSetup: 0,
          maintenance: 0,
          riskControls: 0,
          licenseModifier: 0,
          total: 0,
        },
        stackRank: 1,
      },
    ];
    const base = {
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [] as never[],
      gated: [] as never[],
      excludedSdkOnly: [] as never[],
    };

    // Unmarked + forged kind:production — still fixture (cache pollution path).
    saveRun(synthId, at, {
      ...base,
      runId: synthId,
      generatedAt: at,
      kind: "production" as const,
      dimension: "market-making",
      scored,
      shortlist: scored,
    });
    const synthetic = loadRunFromDb(synthId)!;
    expect(looksLikeSyntheticFixtureRun(synthetic)).toBe(true);
    expect(synthetic.kind).toBe("fixture");
    expect(synthetic.source).toBe("test");
    expect(isEligibleProductionRun(synthetic)).toBe(false);
    expect(isFixtureRun(synthetic)).toBe(true);
    expect(loadLatestRunFromDb({ dimension: "market-making" })?.runId).not.toBe(synthId);

    saveRun(realId, at, {
      ...base,
      runId: realId,
      generatedAt: at,
      kind: "production",
      source: "pipeline",
      dimension: "market-making",
      scored: [
        {
          ...scored[0]!,
          repo: {
            ...syntheticRepo,
            fullName: "rodlaf/KalshiMarketMaker",
            owner: "rodlaf",
            name: "KalshiMarketMaker",
            htmlUrl: "https://github.com/rodlaf/KalshiMarketMaker",
            description: "Kalshi market maker",
            stars: 67,
          },
        },
      ],
      shortlist: [
        {
          ...scored[0]!,
          repo: {
            ...syntheticRepo,
            fullName: "rodlaf/KalshiMarketMaker",
            owner: "rodlaf",
            name: "KalshiMarketMaker",
            htmlUrl: "https://github.com/rodlaf/KalshiMarketMaker",
            description: "Kalshi market maker",
            stars: 67,
          },
        },
      ],
    });
    expect(loadLatestRunFromDb({ dimension: "market-making" })?.runId).toBe(realId);
    expect(purgeIneligibleRuns()).toContain(synthId);
    expect(loadRunFromDb(synthId)).toBeNull();
    expect(loadLatestRunFromDb({ dimension: "market-making" })?.runId).toBe(realId);
  });

  test("saveRun stamps fixture kind and excludes from latest resolution", () => {
    const at = "2099-06-01T00:00:00.000Z";
    saveRun("fixture-kind-run", at, {
      runId: "fixture-kind-run",
      generatedAt: at,
      dimension: "all",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    const loaded = loadRunFromDb("fixture-kind-run");
    expect(loaded?.kind).toBe("fixture");
    expect(loadLatestRunFromDb({ dimension: "all", includeFixtures: false })?.runId).not.toBe(
      "fixture-kind-run",
    );
  });

  test("loadResearchRun rejects fixture run id for operator views", () => {
    const at = "2099-06-02T00:00:00.000Z";
    saveRun("fixture-by-id", at, {
      runId: "fixture-by-id",
      kind: "fixture",
      generatedAt: at,
      dimension: "all",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    expect(loadResearchRun({ runId: "fixture-by-id", dimension: "all" })).toBeNull();
    expect(loadResearchRun({ runId: "fixture-by-id", dimension: "all", includeFixtures: true })?.runId).toBe(
      "fixture-by-id",
    );
  });

  test("loadResearchRun rejects run id when dimension does not match", () => {
    const at = freshTestGeneratedAt();
    saveRun("2026-07-22T09-00-00-001Z", at, {
      runId: "2026-07-22T09-00-00-001Z",
      kind: "production",
      generatedAt: at,
      dimension: "sports-nba",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    expect(loadResearchRun({ runId: "2026-07-22T09-00-00-001Z", dimension: "all" })).toBeNull();
    expect(loadResearchRun({ runId: "2026-07-22T09-00-00-001Z", dimension: "sports-nba" })?.runId).toBe(
      "2026-07-22T09-00-00-001Z",
    );
  });
});
