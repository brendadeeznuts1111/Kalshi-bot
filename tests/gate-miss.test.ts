// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  analyzeGateMiss,
  buildGateRetryCommand,
  formatGateMissHtml,
  formatGateMissMarkdown,
  rankGateNearMisses,
} from "../src/research/gate-miss.ts";
import type { RepoCandidate } from "../src/research/types.ts";

function repo(overrides: Partial<RepoCandidate> = {}): RepoCandidate {
  return {
    fullName: "owner/repo",
    owner: "owner",
    name: "repo",
    htmlUrl: "https://github.com/owner/repo",
    description: null,
    stars: 10,
    forks: 5,
    pushedAt: new Date().toISOString(),
    archived: false,
    topics: [],
    defaultBranch: "main",
    license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
    ...overrides,
  };
}

const gate = { minStars: 5, minForks: 3, maxAgeMonths: 18 };

describe("gate-miss", () => {
  test("rankGateNearMisses surfaces top popularity near misses", () => {
    const candidates = [
      repo({ fullName: "a/one", stars: 4, forks: 2, pushedAt: "2026-01-01T00:00:00Z" }),
      repo({ fullName: "b/two", stars: 1, forks: 0, pushedAt: "2026-01-01T00:00:00Z" }),
      repo({ fullName: "c/three", stars: 4, forks: 1, pushedAt: "2026-01-01T00:00:00Z" }),
    ];
    const near = rankGateNearMisses(candidates, gate, 2);
    expect(near).toHaveLength(2);
    expect(near[0]?.fullName).toBe("a/one");
    expect(near[0]?.summary).toContain("4 stars");
  });

  test("buildGateRetryCommand lowers min-stars from best near miss", () => {
    const nearMisses = rankGateNearMisses(
      [repo({ fullName: "a/nba-bot", stars: 4, forks: 1, pushedAt: "2026-01-01T00:00:00Z" })],
      gate,
    );
    const { retryCommand } = buildGateRetryCommand(gate, nearMisses, "sports-nba");
    expect(retryCommand).toContain("--dimension=sports-nba");
    expect(retryCommand).toContain("--min-stars=4");
    expect(retryCommand).not.toContain("--min-forks=");
  });

  test("analyzeGateMiss undefined when some candidates pass gate", () => {
    const candidates = [repo({ stars: 10 }), repo({ stars: 1 })];
    const gated = [candidates[0]!];
    expect(analyzeGateMiss(candidates, gated, gate)).toBeUndefined();
  });

  test("analyzeGateMiss returns retry when all rejected", () => {
    const candidates = [
      repo({ fullName: "x/y", stars: 4, forks: 1, pushedAt: "2026-01-01T00:00:00Z" }),
    ];
    const miss = analyzeGateMiss(candidates, [], gate, { dimension: "sports-nba" });
    expect(miss?.rejected).toBe(1);
    expect(miss?.nearMisses).toHaveLength(1);
    expect(miss?.retryCommand).toContain("sports-nba");
  });

  test("formatGateMissMarkdown renders near misses and probe command", () => {
    const miss = analyzeGateMiss(
      [repo({ fullName: "a/nba-bot", stars: 4, forks: 1, pushedAt: "2026-01-01T00:00:00Z" })],
      [],
      gate,
      { dimension: "sports-nba" },
    )!;
    const md = formatGateMissMarkdown(miss, gate).join("\n");
    expect(md).toContain("## Gate miss");
    expect(md).toContain("a/nba-bot");
    expect(md).toContain("### Near misses");
    expect(md).toContain("--min-stars=4");
  });

  test("formatGateMissHtml renders panel with near misses", () => {
    const miss = analyzeGateMiss(
      [repo({ fullName: "a/nba-bot", stars: 4, forks: 1, pushedAt: "2026-01-01T00:00:00Z" })],
      [],
      gate,
      { dimension: "sports-nba" },
    )!;
    const html = formatGateMissHtml(miss, gate);
    expect(html).toContain('id="gate-miss-panel"');
    expect(html).toContain("a/nba-bot");
    expect(html).toContain("--min-stars=4");
    expect(html).not.toContain("/api/screenshot");
  });
});
