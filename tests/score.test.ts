// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { scoreRepo } from "../src/research/score.ts";
import type { InspectionSignals, RepoCandidate, ResearchConfig } from "../src/research/types.ts";

const config: ResearchConfig = {
  queries: { candidateCap: 100, queries: [] },
  weights: {
    shortlistSize: 12,
    maxPerTag: 4,
    stackTiebreakThreshold: 5,
    gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 },
    components: {
      authApi: 25,
      orderRealism: 25,
      testsCi: 15,
      docsSetup: 15,
      maintenance: 10,
      riskControls: 10,
    },
    license: { unlicensedPenalty: 15, preferredLicenses: ["mit"] },
  },
  keywords: {
    authCodeSearch: [],
    orderCodeSearch: [],
    riskKeywords: ["kelly", "position size"],
    strategyTags: {},
    majorStrategyTags: [],
  },
};

function signals(overrides: Partial<InspectionSignals> = {}): InspectionSignals {
  return {
    readmeLength: 1000,
    hasSetupSection: true,
    hasStrategySection: true,
    authHits: [],
    orderHits: [],
    usesOfficialSdk: false,
    hasAuthInCode: true,
    hasV2Api: true,
    hasRsaPss: true,
    hasLiveOrderPath: true,
    hasDryRunDefault: true,
    hasTests: true,
    hasCi: true,
    languages: { TypeScript: 100 },
    primaryLanguage: "TypeScript",
    lastDefaultBranchCommitAt: new Date().toISOString(),
    strategyTags: ["arb"],
    isSdkOnly: false,
    riskKeywordHits: ["kelly", "position size", "drawdown"],
    ...overrides,
  };
}

function candidate(): RepoCandidate {
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
  };
}

describe("scoreRepo", () => {
  test("scores strong repos near ceiling with MIT license", () => {
    const score = scoreRepo(candidate(), signals(), config);
    expect(score.total).toBeGreaterThan(90);
    expect(score.licenseModifier).toBe(0);
  });

  test("applies unlicensed penalty", () => {
    const repo = candidate();
    repo.license = { spdxId: null, name: null, preferred: false, unlicensed: true };
    const score = scoreRepo(repo, signals(), config);
    expect(score.licenseModifier).toBe(15);
    expect(score.total).toBeLessThan(90);
  });

  test("rewards auth and order signals", () => {
    const strong = scoreRepo(candidate(), signals(), config);
    const weak = scoreRepo(
      candidate(),
      signals({ hasAuthInCode: false, hasLiveOrderPath: false, hasDryRunDefault: false }),
      config,
    );
    expect(strong.total).toBeGreaterThan(weak.total);
  });
});
