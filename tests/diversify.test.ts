// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { buildShortlist, shortlistTagCoverage } from "../src/research/diversify.ts";
import { loadConfig } from "../src/research/discover.ts";
import type { RepoCandidate, ScoredRepo } from "../src/research/types.ts";

function scored(
  fullName: string,
  total: number,
  tags: string[],
  isSdkOnly = false,
): ScoredRepo {
  const [owner, name] = fullName.split("/") as [string, string];
  const repo: RepoCandidate = {
    fullName,
    owner,
    name,
    htmlUrl: `https://github.com/${fullName}`,
    description: "",
    stars: 10,
    forks: 3,
    pushedAt: "2026-01-01T00:00:00Z",
    archived: false,
    topics: [],
    defaultBranch: "main",
    license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
  };
  return {
    repo,
    signals: {
      readmeLength: 500,
      hasSetupSection: true,
      hasStrategySection: false,
      authHits: [],
      orderHits: [],
      usesOfficialSdk: false,
      hasAuthInCode: true,
      hasV2Api: true,
      hasRsaPss: false,
      hasLiveOrderPath: true,
      hasDryRunDefault: false,
      hasTests: false,
      hasCi: false,
      languages: {},
      primaryLanguage: "TypeScript",
      lastDefaultBranchCommitAt: "2026-06-01T00:00:00Z",
      strategyTags: tags,
      isSdkOnly,
      riskKeywordHits: [],
    },
    score: {
      authApi: 15,
      orderRealism: 15,
      testsCi: 0,
      docsSetup: 10,
      maintenance: 5,
      riskControls: 0,
      licenseModifier: 0,
      total,
    },
    stackRank: 1,
  };
}

describe("diversify", () => {
  test("shortlistTagCoverage respects multi-tag repos", () => {
    const shortlist = [
      scored("a/b", 80, ["market_making", "arb"]),
      scored("c/d", 70, ["market_making"]),
    ];
    const rows = shortlistTagCoverage(shortlist, 4);
    expect(rows.find((r) => r.tag === "market_making")).toEqual({
      tag: "market_making",
      count: 2,
      cap: 4,
      atCap: false,
    });
    expect(rows.find((r) => r.tag === "arb")?.count).toBe(1);
  });

  test("buildShortlist enforces maxPerTag on live-shaped pool", async () => {
    const config = await loadConfig();
    const maxPerTag = config.weights.maxPerTag ?? 4;
    const pool = [
      scored("one/a", 90, ["market_making", "news_event"]),
      scored("two/b", 85, ["market_making", "news_event"]),
      scored("three/c", 80, ["market_making", "news_event"]),
      scored("four/d", 75, ["market_making", "news_event"]),
      scored("five/e", 70, ["market_making"]),
    ];
    const { shortlist } = buildShortlist(pool, config, 12);
    const coverage = shortlistTagCoverage(shortlist, maxPerTag);
    for (const row of coverage) {
      expect(row.count).toBeLessThanOrEqual(maxPerTag);
    }
  });

  test("buildShortlist prefers TypeScript tiebreak within stack threshold", async () => {
    const config = await loadConfig();
    const threshold = config.weights.stackTiebreakThreshold;
    const ts = scored("team/ts-bot", 80, ["market_making"]);
    ts.signals.primaryLanguage = "TypeScript";
    const py = scored("team/py-bot", 80 - threshold + 1, ["market_making"]);
    py.signals.primaryLanguage = "Python";
    const { shortlist } = buildShortlist([py, ts], config, 1);
    expect(shortlist[0]?.repo.fullName).toBe("team/ts-bot");
  });

  test("buildShortlist ensures each available major strategy tag appears once", async () => {
    const config = await loadConfig();
    const pool = [
      scored("alpha/mm", 95, ["market_making"]),
      scored("beta/arb", 72, ["arb"]),
      scored("gamma/sports", 68, ["sports"]),
    ];
    const { shortlist } = buildShortlist(pool, config, 3);
    const pickedTags = new Set(shortlist.flatMap((s) => s.signals.strategyTags));
    expect(pickedTags.has("market_making")).toBe(true);
    expect(pickedTags.has("arb")).toBe(true);
    expect(pickedTags.has("sports")).toBe(true);
  });
});
