// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  buildAuditRunExport,
  evidenceNdjson,
  evidenceFileBody,
  digestEvidenceBody,
  evidenceSha3Fingerprint,
  isHighValueCandidate,
  repoReportToAuditFindingWire,
  sha3Hex,
  shortlistRulesConcept,
} from "../src/research/audit-adapter.ts";
import { monorepoEvidencePath } from "../src/research/export-audit.ts";
import { buildRepoReport } from "../src/research/evidence.ts";
import { loadConfig } from "../src/research/discover.ts";
import type { InspectionSignals, RepoCandidate, ResearchRun, ScoredRepo } from "../src/research/types.ts";

function highValueScored(): ScoredRepo {
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
  };
}

describe("audit-adapter", () => {
  test("sha3Hex is 64 hex chars", () => {
    const digest = sha3Hex("payload");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("finding digest matches evidence file body", () => {
    const report = buildRepoReport(highValueScored(), "2026-07-21T00:00:00.000Z");
    const ndjson = evidenceNdjson(report);
    const body = evidenceFileBody(ndjson);
    const finding = repoReportToAuditFindingWire(report, "run-test");
    expect(finding.evidence.algorithm).toBe("sha3-256");
    expect(finding.evidence.digest).toBe(digestEvidenceBody(body));
    expect(finding.evidence.digest).toBe(sha3Hex(body));
    expect(finding.evidence.mediaType).toBe("application/jsonl");
  });

  test("isHighValueCandidate gates low scores", () => {
    const low = buildRepoReport({
      ...highValueScored(),
      score: { ...highValueScored().score, total: 50, authApi: 10, orderRealism: 10 },
    });
    expect(isHighValueCandidate(low)).toBe(false);
    expect(isHighValueCandidate(buildRepoReport(highValueScored()))).toBe(true);
  });

  test("shortlistRulesConcept references factor stack", async () => {
    const config = await loadConfig();
    const concept = shortlistRulesConcept(config, "2026-07-21T00:00:00.000Z");
    expect(concept.id).toBe("kalshi-shortlist-diversity");
    expect(concept.kind).toBe("AuditConcept");
    expect(concept.relatedDocs).toContain("docs/FACTOR_STACK.md");
    expect(concept.description).toContain(String(config.weights.shortlistSize));
  });

  test("buildAuditRunExport promotes high-value shortlist only", async () => {
    const config = await loadConfig();
    const item = { ...highValueScored(), report: buildRepoReport(highValueScored()) };
    const run: ResearchRun = {
      runId: "2099-test-run",
      generatedAt: "2099-01-01T00:00:00.000Z",
      config: { shortlistSize: 12, gate: config.weights.gate },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [item],
      shortlist: [item],
      excludedSdkOnly: [],
    };
    const exp = buildAuditRunExport(run, config);
    expect(exp.bundles).toHaveLength(1);
    expect(exp.bundles[0]?.finding.related).toContain("kalshi-shortlist-diversity");
  });

  test("monorepoEvidencePath remaps committed evidence path", () => {
    const local = "research/audit-evidence/octagonai__kalshi-trading-bot-cli.jsonl";
    expect(monorepoEvidencePath(local)).toBe(
      "tools/audit-evidence/kalshi/octagonai__kalshi-trading-bot-cli.jsonl",
    );
  });

  test("evidenceSha3Fingerprint is stable", () => {
    const report = buildRepoReport(highValueScored());
    const lines = report.detectors.flatMap((d) => d.evidence);
    expect(evidenceSha3Fingerprint(lines)).toBe(evidenceSha3Fingerprint(lines));
  });
});
