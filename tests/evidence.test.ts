// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  attachRepoReport,
  buildDetectors,
  buildRepoReport,
  deriveLiftNotes,
  evidenceFingerprint,
} from "../src/research/evidence.ts";
import { DETECTOR_IDS } from "../src/research/constants.ts";
import type { InspectionSignals, RepoCandidate, ScoredRepo } from "../src/research/types.ts";

function scored(overrides: Partial<ScoredRepo> = {}): ScoredRepo {
  const repo: RepoCandidate = {
    fullName: "OctagonAI/kalshi-trading-bot-cli",
    owner: "OctagonAI",
    name: "kalshi-trading-bot-cli",
    htmlUrl: "https://github.com/OctagonAI/kalshi-trading-bot-cli",
    description: "test",
    stars: 100,
    forks: 10,
    pushedAt: "2026-01-01T00:00:00Z",
    archived: false,
    topics: [],
    defaultBranch: "main",
    license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
  };
  const signals: InspectionSignals = {
    readmeLength: 1000,
    hasSetupSection: true,
    hasStrategySection: true,
    authHits: [{ query: "KALSHI-ACCESS-SIGNATURE", totalCount: 1, paths: ["src/auth.ts"] }],
    orderHits: [{ query: "CreateOrder", totalCount: 1, paths: ["src/orders.ts"] }],
    usesOfficialSdk: true,
    hasAuthInCode: true,
    hasV2Api: true,
    hasRsaPss: false,
    hasLiveOrderPath: true,
    hasDryRunDefault: true,
      hasAuthFreshness: false,
      hasCentsPriceBounds: false,
    hasTests: true,
    hasCi: true,
    languages: { TypeScript: 100 },
    primaryLanguage: "TypeScript",
    lastDefaultBranchCommitAt: "2026-06-01T00:00:00Z",
    strategyTags: ["market_making"],
    isSdkOnly: false,
    riskKeywordHits: ["kelly"],
    hasFeeAware: false,
    feeAwareKeywordHits: [],
  };
  return {
    repo,
    signals,
    score: {
      authApi: 20,
      orderRealism: 22,
      testsCi: 12,
      docsSetup: 14,
      maintenance: 8,
      riskControls: 5,
      licenseModifier: 0,
      total: 81,
    },
    stackRank: 1,
    ...overrides,
  };
}

describe("buildRepoReport", () => {
  test("produces seven detectors", () => {
    const report = buildRepoReport(scored());
    expect(report.detectors).toHaveLength(7);
    expect(report.fullName).toBe("OctagonAI/kalshi-trading-bot-cli");
  });

  test("feeAware detector when fee keywords present", () => {
    const item = scored({
      signals: {
        ...scored().signals,
        hasFeeAware: true,
        feeAwareKeywordHits: ["taker fee", "net edge"],
      },
    });
    const fee = buildDetectors(item).find((d) => d.id === DETECTOR_IDS.feeAware)!;
    expect(fee.matched).toBe(true);
    expect(fee.evidence[0]?.component).toBe("feeAware");
    expect(fee.pointsContributed).toBeGreaterThan(0);
  });

  test("EvidenceLine from code search hits", () => {
    const auth = buildDetectors(scored()).find((d) => d.id === DETECTOR_IDS.authApi)!;
    expect(auth.evidence[0]?.path).toBe("src/auth.ts");
    expect(auth.evidence[0]?.component).toBe("authApi");
  });

  test("evidenceFingerprint is stable", () => {
    const lines = buildDetectors(scored()).flatMap((d) => d.evidence);
    expect(evidenceFingerprint(lines)).toBe(evidenceFingerprint(lines));
  });

  test("deriveLiftNotes flags sdk-only", () => {
    const notes = deriveLiftNotes(scored({ signals: { ...scored().signals, isSdkOnly: true } }));
    expect(notes).toContain("SDK-only");
  });

  test("attachRepoReport attaches report", () => {
    const item = attachRepoReport(scored());
    expect(item.report?.liftNotes.length).toBeGreaterThan(10);
  });
});
