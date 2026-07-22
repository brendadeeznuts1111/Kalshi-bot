// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { buildRepoReport } from "../src/research/evidence.ts";
import { isRepoReport, validateRepoReport } from "../src/research/validate.ts";
import type { InspectionSignals, RepoCandidate, ScoredRepo } from "../src/research/types.ts";

function scored(): ScoredRepo {
  const repo: RepoCandidate = {
    fullName: "owner/repo",
    owner: "owner",
    name: "repo",
    htmlUrl: "https://github.com/owner/repo",
    description: null,
    stars: 10,
    forks: 3,
    pushedAt: "2026-01-01T00:00:00Z",
    archived: false,
    topics: [],
    defaultBranch: "main",
    license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
  };
  const signals: InspectionSignals = {
    readmeLength: 500,
    hasSetupSection: true,
    hasStrategySection: false,
    authHits: [{ query: "KALSHI-ACCESS-KEY", totalCount: 1, paths: ["auth.ts"] }],
    orderHits: [],
    usesOfficialSdk: false,
    hasAuthInCode: true,
    hasV2Api: true,
    hasRsaPss: false,
    hasLiveOrderPath: false,
    hasDryRunDefault: false,
      hasAuthFreshness: false,
      hasCentsPriceBounds: false,
    hasTests: false,
    hasCi: false,
    languages: { TypeScript: 100 },
    primaryLanguage: "TypeScript",
    lastDefaultBranchCommitAt: null,
    strategyTags: ["arb"],
    isSdkOnly: false,
    riskKeywordHits: [],
    hasFeeAware: false,
    feeAwareKeywordHits: [],
  };
  return {
    repo,
    signals,
    score: {
      authApi: 15,
      orderRealism: 0,
      testsCi: 0,
      docsSetup: 10,
      maintenance: 5,
      riskControls: 0,
      licenseModifier: 0,
      total: 30,
    },
    stackRank: 1,
  };
}

describe("validateRepoReport", () => {
  test("accepts buildRepoReport output", () => {
    const report = buildRepoReport(scored(), "2026-07-21T00:00:00.000Z");
    expect(isRepoReport(report)).toBe(true);
    expect(validateRepoReport(report).fullName).toBe("owner/repo");
  });

  test("rejects malformed wire", () => {
    expect(() => validateRepoReport({ fullName: "bad" })).toThrow(/Invalid RepoReport/);
  });
});
