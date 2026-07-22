// @see https://bun.com/docs/test/index#run-tests
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  DEFAULT_DIMENSION,
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
import { loadLatestRunFromDb, saveRun, CACHE_DB } from "../src/research/cache.ts";
import { diffRuns } from "../src/research/diff.ts";
import type { ResearchRun } from "../src/research/types.ts";
import { REPORT_DIR, joinPath } from "../src/research/paths.ts";
import { freshTestGeneratedAt } from "./fixtures.ts";

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
  test("normalizeDimensionId defaults to all", () => {
    expect(normalizeDimensionId(undefined)).toBe(DEFAULT_DIMENSION);
    expect(normalizeDimensionId("  ")).toBe(DEFAULT_DIMENSION);
    expect(normalizeDimensionId("sports")).toBe("sports");
  });

  test("resolveDimensionQueries returns queries and cap", () => {
    const resolved = resolveDimensionQueries(SAMPLE_DIMENSIONS, "market-making");
    expect(resolved.dimension).toBe("market-making");
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
    expect(runDimension({})).toBe("all");
    expect(runDimension({ dimension: "sports" })).toBe("sports");
  });

  test("listDimensionIds is sorted", () => {
    expect(listDimensionIds(SAMPLE_DIMENSIONS)).toEqual(["all", "market-making", "sports"]);
  });

  test("dimensions.json defines sports sub-slices (no broad sports)", async () => {
    const file = await loadDimensionsFile();
    expect(file.dimensions.sports).toBeUndefined();
    expect(file.dimensions["sports-nba"]?.queries.length).toBeGreaterThan(0);
    expect(file.dimensions["sports-nfl"]?.queries.length).toBeGreaterThan(0);
    expect(file.dimensions["sports-elections"]?.queries.length).toBeGreaterThan(0);
    const ids = listDimensionIds(file);
    expect(ids.filter((id) => id.startsWith("sports-"))).toEqual([
      "sports-elections",
      "sports-macro",
      "sports-nba",
      "sports-nfl",
      "sports-other",
      "sports-soccer",
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

  test("loadLatestRunFromDb filters by dimension", () => {
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
      dimension: "sports",
    });

    expect(loadLatestRunFromDb({ dimension: "sports", includeFixtures: true })?.runId).toBe(
      "2099-dimension-sports",
    );
    expect(loadLatestRunFromDb({ dimension: "all", includeFixtures: true })?.runId).not.toBe(
      "2099-dimension-sports",
    );
  });
});
