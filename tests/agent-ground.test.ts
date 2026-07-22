// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { parseAgentCommand } from "../src/agent/cli.ts";
import {
  formatDiscoveryGround,
  runDiscoveryGround,
} from "../src/agent/discovery-ground.ts";
import { saveRun, saveSearchCache, searchQueryKey } from "../src/research/cache.ts";
import { buildRepoSearchQuery } from "../src/research/discover.ts";
import type { ResearchRun } from "../src/research/types.ts";
import { freshTestGeneratedAt, mintTestProductionRunId } from "./fixtures.ts";
import { withTempCache } from "./temp-cache.ts";

function baseRun(overrides: Partial<ResearchRun> = {}): ResearchRun {
  const runId = overrides.runId ?? mintTestProductionRunId();
  const at = overrides.generatedAt ?? freshTestGeneratedAt();
  return {
    runId,
    generatedAt: at,
    kind: "production",
    source: "pipeline",
    dimension: "market-making",
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: { discovered: 0, gated: 0, inspected: 0, shortlist: 0 },
    candidates: [],
    gated: [],
    scored: [],
    shortlist: [],
    excludedSdkOnly: [],
    ...overrides,
  };
}

describe("agent ground", () => {
  test("parseAgentCommand recognizes ground", () => {
    expect(parseAgentCommand(["ground"]).command).toBe("ground");
    expect(parseAgentCommand(["ground", "--", "--dimension=x"]).rest).toEqual([
      "--dimension=x",
    ]);
  });

  test("no run → nextActions include research and research:dry", async () => {
    await withTempCache(async () => {
      const report = await runDiscoveryGround({ dimension: "market-making" });
      expect(report.grounded).toBe(true);
      expect(report.source).toBe("cache.db");
      expect(report.status.latestRun).toBeNull();
      expect(report.miss.kind).toBe("no-run");
      expect(report.cache.searchCacheReady).toBe(false);
      expect(report.cache.dimensionCoverageLabel).toMatch(/^\d+\/\d+$/);
      // Discover is broad by default; apply keeps shortlist thresholds.
      expect(report.gates.discover.minStars).toBe(0);
      expect(report.gates.discover.minForks).toBe(0);
      expect(report.gates.apply.minStars).toBe(5);
      const joined = report.nextActions.join("\n");
      expect(joined).toContain("research:dry");
      expect(joined).toContain("bun run research --");
      expect(joined).toContain("--dimension=market-making");
      expect(joined).not.toContain("agent ground --");

      const text = formatDiscoveryGround(report);
      expect(text).toContain("── status ──");
      expect(text).toContain("── cache ──");
      expect(text).toContain("dimension coverage:");
      expect(text).toContain("Gates: discover");
      expect(text).toContain("── miss ──");
      expect(text).toContain("── next actions ──");
      // Compact status: no nested triage self-loop.
      expect(text).not.toContain("Triage: bun run agent ground");
    });
  });

  test("unknown dimension surfaces Available hint", async () => {
    await withTempCache(async () => {
      const report = await runDiscoveryGround({ dimension: "zzz-nope" });
      expect(report.miss.kind).toBe("unknown-dimension");
      expect(report.miss.hint).toMatch(/Unknown research dimension/i);
      expect(report.miss.hint).toMatch(/Available:/i);
      expect(report.cache.dimensionCoverageLabel).toBe("n/a");
      expect(formatDiscoveryGround(report)).toContain("Unknown research dimension");
    });
  });

  test("zero shortlist without miss does not self-loop to ground", async () => {
    await withTempCache(async () => {
      const runId = mintTestProductionRunId();
      const at = freshTestGeneratedAt();
      saveRun(
        runId,
        at,
        baseRun({
          runId,
          generatedAt: at,
          stats: { discovered: 2, gated: 2, inspected: 2, shortlist: 0 },
        }),
      );
      const report = await runDiscoveryGround({ dimension: "market-making" });
      expect(report.miss.kind).toBe("none");
      expect(report.status.latestRun?.shortlist).toBe(0);
      const joined = report.nextActions.join("\n");
      expect(joined).not.toContain("agent ground");
      expect(joined).toContain("bun run research --");
      expect(joined).toContain("agent report");
    });
  });

  test("qualifier drift (stars:/pushed:) counts as normalized coverage", async () => {
    await withTempCache(async () => {
      // Historical discover used stars:>=1; today's broad discover omits stars:.
      const legacy =
        "kalshi market maker stars:>=1 pushed:>=2025-01-01";
      saveSearchCache(searchQueryKey(legacy), legacy, '"etag-legacy"', []);

      const report = await runDiscoveryGround({ dimension: "market-making" });
      // Infer discover from cache era (stars:>=1), not silent resolveDiscoverGate(0/0).
      expect(report.gates.discoverSource).toBe("inferred-cache");
      expect(report.gates.discover.minStars).toBe(1);
      expect(report.cache.searchCacheReady).toBe(true);
      // Month-floored pushed: may promote to exact; otherwise normalized.
      expect(
        report.cache.coverageExact + report.cache.coverageNormalized,
      ).toBeGreaterThanOrEqual(1);
      expect(report.cache.dimensionQueryCached).toBeGreaterThanOrEqual(1);
      expect(report.cache.coldQueries.length).toBeGreaterThan(0);
      // Partial coverage → warm cold queries before dry.
      expect(report.nextActions[0]).toContain("cold discover queries");
      expect(formatDiscoveryGround(report)).toContain("cold queries");
      expect(formatDiscoveryGround(report)).toContain("inferred-cache");
    });
  });

  test("saveRun stamps discoverGate from discoveryMiss.searchQueries", async () => {
    await withTempCache(async () => {
      const runId = mintTestProductionRunId();
      const at = freshTestGeneratedAt();
      saveRun(
        runId,
        at,
        baseRun({
          runId,
          generatedAt: at,
          stats: { discovered: 0, gated: 0, inspected: 0, shortlist: 0 },
          discoveryMiss: {
            dimension: "market-making",
            label: "Market making",
            queriesTried: ["kalshi market maker"],
            searchQueries: [
              "kalshi market maker stars:>=2 pushed:>=2025-01-01",
              "kalshi liquidity stars:>=2 pushed:>=2025-01-01",
            ],
            alternateQueries: [],
            relaxedGateHint: "hint",
            retryCommand: "bun run research -- --dimension=market-making --min-stars=1",
          },
        }),
      );
      const report = await runDiscoveryGround({ dimension: "market-making" });
      // Write-time stamp from miss queries — ground reads stamped, not inferred-miss.
      expect(report.gates.discoverSource).toBe("stamped");
      expect(report.gates.discover.minStars).toBe(2);
    });
  });

  test("healthy shortlist still surfaces cold discover queries", async () => {
    await withTempCache(async () => {
      const runId = mintTestProductionRunId();
      const at = freshTestGeneratedAt();
      saveRun(
        runId,
        at,
        baseRun({
          runId,
          generatedAt: at,
          stats: { discovered: 4, gated: 3, inspected: 3, shortlist: 2 },
        }),
      );
      const discoverGate = { minStars: 0, minForks: 0, maxAgeMonths: 18 };
      const q = buildRepoSearchQuery("kalshi market maker", discoverGate);
      saveSearchCache(searchQueryKey(q), q, '"etag"', []);

      const report = await runDiscoveryGround({ dimension: "market-making" });
      expect(report.status.latestRun?.shortlist).toBe(2);
      expect(report.cache.coldQueries.length).toBeGreaterThan(0);
      const joined = report.nextActions.join("\n");
      expect(joined).toContain("cold discover queries");
      expect(joined).toContain("agent patterns");
    });
  });

  test("exact discover-gate hash counts as exact coverage", async () => {
    await withTempCache(async () => {
      const discoverGate = { minStars: 0, minForks: 0, maxAgeMonths: 18 };
      const q = buildRepoSearchQuery("kalshi market maker", discoverGate);
      saveSearchCache(searchQueryKey(q), q, '"etag-discover"', []);

      const report = await runDiscoveryGround({ dimension: "market-making" });
      expect(report.cache.coverageExact).toBeGreaterThanOrEqual(1);
      expect(report.cache.dimensionQueryCached).toBeGreaterThanOrEqual(1);
    });
  });

  test("stamped config.discoverGate wins over resolveDiscoverGate", async () => {
    await withTempCache(async () => {
      const runId = mintTestProductionRunId();
      const at = freshTestGeneratedAt();
      saveRun(
        runId,
        at,
        baseRun({
          runId,
          generatedAt: at,
          config: {
            shortlistSize: 12,
            gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 },
            discoverGate: { minStars: 2, minForks: 1, maxAgeMonths: 12 },
          },
        }),
      );
      const report = await runDiscoveryGround({ dimension: "market-making" });
      expect(report.gates.discoverSource).toBe("stamped");
      expect(report.gates.discover).toEqual({
        minStars: 2,
        minForks: 1,
        maxAgeMonths: 12,
      });
    });
  });

  test("seeded discoveryMiss → miss section + retry command", async () => {
    await withTempCache(async () => {
      const runId = mintTestProductionRunId();
      const at = freshTestGeneratedAt();
      const run = baseRun({
        runId,
        generatedAt: at,
        stats: { discovered: 0, gated: 0, inspected: 0, shortlist: 0 },
        discoveryMiss: {
          dimension: "market-making",
          label: "Market making",
          queriesTried: ["kalshi market maker"],
          searchQueries: ["kalshi market maker stars:>=5"],
          alternateQueries: [
            { query: "kalshi bot", rationale: "Broader query from all dimension" },
          ],
          relaxedGateHint: "Relaxed gate: min-stars=1",
          retryCommand: "bun run research -- --dimension=market-making --min-stars=1",
        },
      });
      saveRun(runId, at, run);

      const report = await runDiscoveryGround({ dimension: "market-making" });
      expect(report.status.latestRun?.runId).toBe(runId);
      expect(report.miss.kind).toBe("discovery");
      expect(report.miss.discoveryMiss?.retryCommand).toContain("--dimension=market-making");
      expect(report.nextActions.some((a) => a.includes("--min-stars=1"))).toBe(true);

      const text = formatDiscoveryGround(report);
      expect(text).toContain("Discovery miss");
      expect(text).toContain("kalshi bot");
      expect(text).toContain("── next actions ──");
    });
  });

  test("cross-dimension fallback when dimension has no run", async () => {
    await withTempCache(async () => {
      const runId = mintTestProductionRunId();
      const at = freshTestGeneratedAt();
      saveRun(
        runId,
        at,
        baseRun({
          runId,
          generatedAt: at,
          dimension: "market-making",
          stats: { discovered: 2, gated: 2, inspected: 2, shortlist: 1 },
        }),
      );
      const report = await runDiscoveryGround({ dimension: "arbitrage" });
      expect(report.miss.kind).toBe("no-run");
      expect(report.miss.crossDimensionFallback?.dimension).toBe("market-making");
      expect(report.miss.crossDimensionFallback?.runId).toBe(runId);
      expect(report.nextActions.join("\n")).toContain("sibling run");
    });
  });
});
