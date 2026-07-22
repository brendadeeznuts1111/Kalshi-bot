// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { diffRuns, formatDiffMarkdown } from "../src/research/diff.ts";
import type { ResearchRun, ScoredRepo } from "../src/research/types.ts";

function scored(fullName: string, total: number): ScoredRepo {
  const [owner, name] = fullName.split("/") as [string, string];
  return {
    repo: {
      fullName,
      owner,
      name,
      htmlUrl: `https://github.com/${fullName}`,
      description: null,
      stars: 10,
      forks: 3,
      pushedAt: "2026-01-01T00:00:00Z",
      archived: false,
      topics: [],
      defaultBranch: "main",
      license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
    },
    signals: {
      readmeLength: 100,
      hasSetupSection: true,
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
      primaryLanguage: "TypeScript",
      lastDefaultBranchCommitAt: null,
      strategyTags: ["arb"],
      isSdkOnly: false,
      riskKeywordHits: [],
      hasFeeAware: false,
      feeAwareKeywordHits: [],
    },
    score: {
      authApi: 0,
      orderRealism: 0,
      testsCi: 0,
      docsSetup: 0,
      maintenance: 0,
      riskControls: 0,
      licenseModifier: 0,
      total,
    },
    stackRank: 1,
  };
}

function researchRun(id: string, items: ScoredRepo[]): ResearchRun {
  return {
    runId: id,
    generatedAt: "2026-07-22T00:00:00.000Z",
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: { discovered: 1, gated: items.length, inspected: items.length, shortlist: items.length },
    candidates: [],
    gated: [],
    scored: items,
    shortlist: items,
    excludedSdkOnly: [],
  };
}

describe("diffRuns", () => {
  test("first run lists all repos as new entrants", () => {
    const current = researchRun("2026-07-22T04-00-00-000Z", [scored("a/r", 80)]);
    const diff = diffRuns(null, current);
    expect(diff.previousRunId).toBeNull();
    expect(diff.newEntrants).toEqual(["a/r"]);
    expect(diff.shortlistChanges.added).toEqual(["a/r"]);
  });

  test("detects score deltas and shortlist churn", () => {
    const previous = researchRun("2026-07-22T03-00-00-000Z", [scored("a/r", 70), scored("b/r", 60)]);
    const current = researchRun("2026-07-22T04-00-00-000Z", [scored("a/r", 80), scored("c/r", 55)]);
    const diff = diffRuns(previous, current);
    expect(diff.dropped).toEqual(["b/r"]);
    expect(diff.newEntrants).toEqual(["c/r"]);
    expect(diff.scoreDeltas[0]).toMatchObject({ fullName: "a/r", previous: 70, current: 80, delta: 10 });
    expect(diff.shortlistChanges.added).toContain("c/r");
    expect(diff.shortlistChanges.removed).toContain("b/r");
  });

  test("formatDiffMarkdown notes first run", () => {
    const current = researchRun("2026-07-22T04-00-00-000Z", [scored("a/r", 80)]);
    const md = formatDiffMarkdown(diffRuns(null, current), current);
    expect(md).toContain("First run");
  });
});
