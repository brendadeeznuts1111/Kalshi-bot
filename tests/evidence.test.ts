// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  attachRepoReport,
  buildDetectors,
  buildRepoReport,
  deriveLiftNotes,
  evidenceFingerprint,
} from "../src/research/evidence.ts";
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
    hasTests: true,
    hasCi: true,
    languages: { TypeScript: 100 },
    primaryLanguage: "TypeScript",
    lastDefaultBranchCommitAt: "2026-06-01T00:00:00Z",
    strategyTags: ["market_making"],
    isSdkOnly: false,
    riskKeywordHits: ["kelly"],
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
  test("produces six detectors", () => {
    const report = buildRepoReport(scored());
    expect(report.detectors).toHaveLength(6);
    expect(report.fullName).toBe("OctagonAI/kalshi-trading-bot-cli");
  });

  test("EvidenceLine from code search hits", () => {
    const auth = buildDetectors(scored()).find((d) => d.id === "auth-api")!;
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
