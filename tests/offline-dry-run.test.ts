// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { buildRepoSearchQuery, loadConfig } from "../src/research/discover.ts";
import { resolveGates } from "../src/research/discover-gate.ts";
import { normalizeDimensionId, resolveDimensionQueries } from "../src/research/dimensions.ts";
import { saveSearchCache, searchQueryKey } from "../src/research/cache.ts";
import { parseCliOptions, runResearchDryRun } from "../src/research/cli.ts";
import { offlineCodeSearchSnapshot } from "../src/research/github-rate-limit.ts";
import type { GhSearchRepo } from "../src/research/github-search.ts";
import { withTempCache } from "./temp-cache.ts";

describe("offline dry-run", () => {
  test("offlineCodeSearchSnapshot sizes remaining to estimated calls", () => {
    const snap = offlineCodeSearchSnapshot(294);
    expect(snap.resource).toBe("code_search");
    expect(snap.remaining).toBe(294);
    expect(snap.limit).toBe(294);
    const idle = offlineCodeSearchSnapshot(0);
    expect(idle.remaining).toBe(10);
    expect(idle.limit).toBe(10);
  });

  test("runResearchDryRun --offline uses search_cache only", async () => {
    await withTempCache(async () => {
      const opts = parseCliOptions([
        "--dry-run",
        "--offline",
        "--dimension=market-making",
        "--discover-broad",
      ]);
      const config = await loadConfig();
      const dimension = normalizeDimensionId(opts.dimension);
      const gateInput = {
        minStars: config.weights.gate.minStars,
        minForks: config.weights.gate.minForks,
        maxAgeMonths: config.weights.gate.maxAgeMonths,
      };
      const { discover: discoverGate } = resolveGates(gateInput, { discoverBroad: true });
      const querySet = resolveDimensionQueries(config.dimensions, dimension);
      const searchQuery = buildRepoSearchQuery(querySet.queries[0]!, discoverGate);

      const fixture: GhSearchRepo = {
        fullName: "offline-fixture/mm-bot",
        description: "offline dry-run fixture",
        stargazersCount: 50,
        forksCount: 10,
        pushedAt: new Date().toISOString(),
        isArchived: false,
        url: "https://github.com/offline-fixture/mm-bot",
        defaultBranch: "main",
        license: { spdxId: "MIT", name: "MIT", key: "mit" },
      };
      saveSearchCache(searchQueryKey(searchQuery), searchQuery, '"offline-etag"', [fixture]);

      const result = await runResearchDryRun(opts);

      expect(result.ok).toBe(true);
      expect(result.plan.offline).toBe(true);
      expect(result.plan.dimension).toBe(dimension);
      expect(result.plan.discovered).toBeGreaterThanOrEqual(1);
      expect(result.plan.allowance.allowed).toBe(true);
      expect(result.plan.budget.codeSearchRemaining).toBeGreaterThanOrEqual(
        result.plan.budget.estimatedCodeSearchCalls,
      );
      expect(result.plan.searchCacheHits).toBeGreaterThanOrEqual(1);
      expect(result.plan.timings?.discover).toBeGreaterThanOrEqual(0);
    });
  });

  test("runResearchDryRun --offline fails clearly when cache empty", async () => {
    await withTempCache(async () => {
      await expect(
        runResearchDryRun({
          json: false,
          exportAudit: false,
          dryRun: true,
          offline: true,
          dimension: "sports-nba",
          minStars: 999_999,
          discoverMinStars: 999_999,
        }),
      ).rejects.toThrow(/Offline discover: no search_cache/);
    });
  });
});
