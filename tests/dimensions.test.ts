// @see https://bun.com/docs/test/index#run-tests
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  DEFAULT_DIMENSION,
  asDimensionId,
  dimensionArtifactBasename,
  listDimensionIds,
  normalizeDimensionId,
  resolveDimensionQueries,
  runDimension,
  loadDimensionsFile,
} from "../src/research/dimensions.ts";
import { parseCliOptions } from "../src/research/cli.ts";
import { parseExportAuditCli } from "../src/research/export-audit-cli.ts";
import { formatReportMarkdown, writeOutputs } from "../src/research/report.ts";
import { loadLatestRunFromDb, loadResearchRun, saveRun, CACHE_DB } from "../src/research/cache.ts";
import { diffRuns } from "../src/research/diff.ts";
import type { ResearchRun } from "../src/research/types.ts";
import { REPORT_DIR, joinPath } from "../src/research/paths.ts";
import { freshTestGeneratedAt, mintTestProductionRunId } from "./fixtures.ts";

const SAMPLE_DIMENSIONS = {
  candidateCap: 50,
  defaultDimension: "all",
  dimensions: {
    all: { label: "Broad", queries: ["kalshi bot"] },
    "market-making": { label: "MM", queries: ["kalshi market maker", "quoting kalshi"] },
    sports: { label: "Sports", queries: ["Kalshi NBA"] },
  },
};

describe("dimensions", () => {
  test("normalizeDimensionId returns branded DimensionId", () => {
    const id = normalizeDimensionId("market-making");
    expect(id).toBe(asDimensionId("market-making"));
    expect(typeof id).toBe("string");
  });

  test("normalizeDimensionId defaults to all", () => {
    expect(normalizeDimensionId(undefined)).toBe(DEFAULT_DIMENSION);
    expect(normalizeDimensionId("  ")).toBe(DEFAULT_DIMENSION);
    expect(normalizeDimensionId("sports")).toBe(asDimensionId("sports"));
  });

  test("resolveDimensionQueries returns queries and cap", () => {
    const resolved = resolveDimensionQueries(SAMPLE_DIMENSIONS, "market-making");
    expect(resolved.dimension).toBe(asDimensionId("market-making"));
    expect(resolved.label).toBe("MM");
    expect(resolved.queries).toHaveLength(2);
    expect(resolved.candidateCap).toBe(50);
  });

  test("resolveDimensionQueries throws for unknown dimension", () => {
    expect(() => resolveDimensionQueries(SAMPLE_DIMENSIONS, "nope")).toThrow(
      /Unknown research dimension/,
    );
  });

  test("dimensionArtifactBasename maps all vs scoped", () => {
    expect(dimensionArtifactBasename("all")).toBe("latest");
    expect(dimensionArtifactBasename("market-making")).toBe("latest-market-making");
  });

  test("runDimension treats legacy runs as all", () => {
    expect(runDimension({})).toBe(DEFAULT_DIMENSION);
    expect(runDimension({ dimension: "sports" })).toBe(asDimensionId("sports"));
  });

  test("listDimensionIds is sorted", () => {
    expect(listDimensionIds(SAMPLE_DIMENSIONS)).toEqual([
      asDimensionId("all"),
      asDimensionId("market-making"),
      asDimensionId("sports"),
    ]);
  });

  test("dimensions.json defines odds-feed only (not ticker-mapper / shadow-bot)", async () => {
    const file = await loadDimensionsFile();
    expect(file.dimensions["odds-feed"]?.queries.length).toBeGreaterThan(0);
    expect(file.dimensions["ticker-mapper"]).toBeUndefined();
    expect(file.dimensions["shadow-bot"]).toBeUndefined();
    expect(listDimensionIds(file)).toContain(asDimensionId("odds-feed"));
  });

  test("dimensions.json defines sports sub-slices (no broad sports)", async () => {
    const file = await loadDimensionsFile();
    expect(file.dimensions.sports).toBeUndefined();
    expect(file.dimensions["sports-nba"]?.queries.length).toBeGreaterThan(0);
    expect(file.dimensions["sports-nfl"]?.queries.length).toBeGreaterThan(0);
    expect(file.dimensions["sports-elections"]?.queries.length).toBeGreaterThan(0);
    const ids = listDimensionIds(file);
    expect(ids.filter((id) => id.startsWith("sports-"))).toEqual([
      asDimensionId("sports-elections"),
      asDimensionId("sports-macro"),
      asDimensionId("sports-nba"),
      asDimensionId("sports-nfl"),
      asDimensionId("sports-other"),
      asDimensionId("sports-soccer"),
      asDimensionId("sports-tennis"),
    ]);
  });

  test("every dimension in dimensions.json has at least one query", async () => {
    const file = await loadDimensionsFile();
    for (const id of listDimensionIds(file)) {
      const def = file.dimensions[id];
      expect(def?.queries.length).toBeGreaterThan(0);
      expect(def?.label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("parseCliOptions dimension", () => {
  test("parses --dimension flag", () => {
    expect(parseCliOptions(["--dimension=market-making"]).dimension).toBe("market-making");
  });

  test("parses --dry-run flag", () => {
    expect(parseCliOptions([]).dryRun).toBe(false);
    expect(parseCliOptions(["--dry-run"]).dryRun).toBe(true);
    expect(parseCliOptions(["--dry-run", "--dimension=sports-nba"]).dryRun).toBe(true);
  });

  test("parses --offline flag", () => {
    expect(parseCliOptions([]).offline).toBe(false);
    expect(parseCliOptions(["--offline"]).offline).toBe(true);
    expect(parseCliOptions(["--dry-run", "--offline"]).offline).toBe(true);
  });

  test("reads RESEARCH_DIMENSION env", () => {
    const prev = Bun.env.RESEARCH_DIMENSION;
    Bun.env.RESEARCH_DIMENSION = "sports";
    try {
      expect(parseCliOptions([]).dimension).toBe("sports");
    } finally {
      if (prev === undefined) delete Bun.env.RESEARCH_DIMENSION;
      else Bun.env.RESEARCH_DIMENSION = prev;
    }
  });
});

describe("parseExportAuditCli dimension", () => {
  test("parses --dimension for --latest", () => {
    expect(parseExportAuditCli(["--latest", "--dimension=tracking"]).dimension).toBe("tracking");
  });
});

/** Remove legacy dimension-test runs that used production-shaped ids (cache pollution). */
afterAll(() => {
  const db = new Database(CACHE_DB);
  for (const id of ["2026-07-22T10-00-00-000Z", "2026-07-22T11-00-00-000Z"]) {
    db.run("DELETE FROM runs WHERE run_id = ?", [id]);
  }
});

describe("dimension reports", () => {
  test("formatReportMarkdown includes dimension line", () => {
    const md = formatReportMarkdown(
      {
        runId: "2026-07-22T00-00-00-000Z",
        generatedAt: "2026-07-22T00:00:00.000Z",
        dimension: "market-making",
        config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
        stats: { discovered: 0, gated: 0, inspected: 0, shortlist: 0 },
        candidates: [],
        gated: [],
        scored: [],
        shortlist: [],
        excludedSdkOnly: [],
      },
      "Market making / liquidity",
    );
    expect(md).toContain("Dimension: `market-making`");
    expect(md).toContain("latest-market-making.diff.md");
  });

  test("formatReportMarkdown includes gate miss near misses and probe", () => {
    const md = formatReportMarkdown({
      runId: "2026-07-22T00-00-00-000Z",
      generatedAt: "2026-07-22T00:00:00.000Z",
      dimension: "sports-nba",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 2, gated: 0, inspected: 0, shortlist: 0 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
      gateMiss: {
        rejected: 2,
        nearMisses: [
          {
            fullName: "a/nba-bot",
            stars: 4,
            forks: 1,
            pushedAt: "2026-01-01T00:00:00Z",
            pushedLabel: "2026-01",
            reasons: ["low_popularity"],
            summary: "4 stars, 1 forks — 1 star(s) below min-stars=5",
          },
        ],
        retryCommand: "bun run research -- --dimension=sports-nba --min-stars=4",
        retryHint: null,
      },
    });
    expect(md).toContain("## Gate miss");
    expect(md).toContain("a/nba-bot");
    expect(md).toContain("--min-stars=4");
  });

  test("writeOutputs writes scoped latest files", async () => {
    const run: ResearchRun = {
      runId: "dim-test-run",
      generatedAt: "2026-01-01T00:00:00.000Z",
      dimension: "sports",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 0 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    };
    const diff = diffRuns(null, run);
    await writeOutputs(run, diff, { dimensionLabel: "Sport-specific bots" });

    const scoped = joinPath(REPORT_DIR, "latest-sports.md");
    expect(await Bun.file(scoped).exists()).toBe(true);
    const text = await Bun.file(scoped).text();
    expect(text).toContain("Dimension: `sports`");
  });

  test("loadResearchRun loads latest run for a dimension", async () => {
    const { withTempCache } = await import("./temp-cache.ts");
    await withTempCache(async () => {
      const runId = mintTestProductionRunId();
      const at = freshTestGeneratedAt();
      saveRun(runId, at, {
        runId,
        generatedAt: at,
        dimension: "arbitrage",
        kind: "production",
        config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
        stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 0 },
        candidates: [],
        gated: [],
        scored: [],
        shortlist: [],
        excludedSdkOnly: [],
      });
      const run = loadResearchRun({ dimension: "arbitrage" });
      expect(run).not.toBeNull();
      expect(runDimension(run!)).toBe(asDimensionId("arbitrage"));
    });
  });

  test("loadLatestRunFromDb filters by dimension", async () => {
    const { withTempCache } = await import("./temp-cache.ts");
    await withTempCache(async () => {
      const at = freshTestGeneratedAt();
      const base = {
        config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
        stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 0 },
        candidates: [],
        gated: [],
        scored: [],
        shortlist: [],
        excludedSdkOnly: [],
      };
      saveRun("2099-dimension-sports", at, {
        ...base,
        runId: "2099-dimension-sports",
        generatedAt: at,
        dimension: "sports-test-isolation",
        kind: "fixture",
      });

      expect(loadLatestRunFromDb({ dimension: "sports-test-isolation", includeFixtures: true })?.runId).toBe(
        "2099-dimension-sports",
      );
      expect(loadLatestRunFromDb({ dimension: "all", includeFixtures: true })?.runId).not.toBe(
        "2099-dimension-sports",
      );
    });
  });
});
