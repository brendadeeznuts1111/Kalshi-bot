// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  analyzeDiscoveryMiss,
  formatDiscoveryMissHtml,
  formatDiscoveryMissMarkdown,
  proposeAlternateDiscoveryQueries,
} from "../src/research/discovery-miss.ts";
import { resolveDimensionQueries, type DimensionsFile } from "../src/research/dimensions.ts";

const dimensionsFile: DimensionsFile = {
  candidateCap: 100,
  defaultDimension: "all",
  dimensions: {
    all: {
      label: "Broad discovery",
      queries: ["kalshi bot", "kalshi trading bot", "kalshi market maker"],
    },
    "sports-nba": {
      label: "NBA",
      queries: ["Kalshi NBA", "NBA player props kalshi", "NBA Kalshi bot"],
    },
  },
};

const gate = { minStars: 5, minForks: 3, maxAgeMonths: 18 };

describe("discovery-miss", () => {
  test("proposeAlternateDiscoveryQueries pulls broader all-dimension queries", () => {
    const resolved = resolveDimensionQueries(dimensionsFile, "sports-nba");
    const alternates = proposeAlternateDiscoveryQueries("sports-nba", resolved, dimensionsFile);
    expect(alternates.length).toBeGreaterThanOrEqual(2);
    expect(alternates.some((a) => a.query === "kalshi bot")).toBe(true);
    expect(alternates[0]?.rationale).toContain("all");
  });

  test("analyzeDiscoveryMiss undefined when discovery non-zero", () => {
    const resolved = resolveDimensionQueries(dimensionsFile, "sports-nba");
    expect(analyzeDiscoveryMiss("sports-nba", resolved, gate, dimensionsFile, 3)).toBeUndefined();
  });

  test("analyzeDiscoveryMiss returns retry and alternates at zero discovery", () => {
    const resolved = resolveDimensionQueries(dimensionsFile, "sports-nba");
    const miss = analyzeDiscoveryMiss("sports-nba", resolved, gate, dimensionsFile, 0);
    expect(miss?.dimension).toBe("sports-nba");
    expect(miss?.alternateQueries.length).toBeGreaterThanOrEqual(2);
    expect(miss?.retryCommand).toContain("--dimension=sports-nba");
    expect(miss?.retryCommand).toContain("--min-stars=1");
    expect(miss?.relaxedGateHint).toContain("min-stars=1");
  });

  test("formatDiscoveryMissMarkdown renders section with alternates", () => {
    const resolved = resolveDimensionQueries(dimensionsFile, "sports-nba");
    const miss = analyzeDiscoveryMiss("sports-nba", resolved, gate, dimensionsFile, 0)!;
    const md = formatDiscoveryMissMarkdown(miss).join("\n");
    expect(md).toContain("## Discovery miss");
    expect(md).toContain("### Alternate queries");
    expect(md).toContain("### Suggested probe");
    expect(md).toContain("kalshi bot");
  });

  test("formatDiscoveryMissHtml renders panel", () => {
    const resolved = resolveDimensionQueries(dimensionsFile, "sports-nba");
    const miss = analyzeDiscoveryMiss("sports-nba", resolved, gate, dimensionsFile, 0)!;
    const html = formatDiscoveryMissHtml(miss, { escapeHtml: (s) => s });
    expect(html).toContain('id="discovery-miss-panel"');
    expect(html).toContain("Discovery miss");
    expect(html).toContain("kalshi bot");
  });
});
