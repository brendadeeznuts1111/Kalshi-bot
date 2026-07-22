// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { buildRepoReport } from "../src/research/evidence.ts";
import { loadConfig } from "../src/research/discover.ts";
import {
  buildRotorIngestWire,
  monorepoEvidencePath,
  verifyLocalAuditExport,
  writeAuditExports,
} from "../src/research/export-audit.ts";
import { auditEvidenceAbsPath, auditEvidenceRelPath } from "../src/research/paths.ts";
import type { InspectionSignals, RepoCandidate, ResearchRun, ScoredRepo } from "../src/research/types.ts";

const ROOT = join(import.meta.dir, "..");
const TEST_RUN_ID = "2099-export-audit-test";

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
    report: buildRepoReport({
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
    }),
  };
}

async function cleanupExport(): Promise<void> {
  await rm(join(ROOT, "research/exports/audit", TEST_RUN_ID), { recursive: true, force: true });
  await rm(auditEvidenceAbsPath("OctagonAI/kalshi-trading-bot-cli"), { force: true });
}

describe("export-audit", () => {
  afterEach(async () => {
    await cleanupExport();
  });

  test("writeAuditExports + verifyLocalAuditExport round-trip", async () => {
    const config = await loadConfig();
    const item = highValueScored();
    const run: ResearchRun = {
      runId: TEST_RUN_ID,
      generatedAt: "2099-01-01T00:00:00.000Z",
      config: { shortlistSize: 12, gate: config.weights.gate },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [item],
      shortlist: [item],
      excludedSdkOnly: [],
    };

    const dir = await writeAuditExports(run, config);
    expect(dir).toBe(`research/exports/audit/${TEST_RUN_ID}`);
    expect(auditEvidenceRelPath("OctagonAI/kalshi-trading-bot-cli")).toBe(
      "research/audit-evidence/octagonai__kalshi-trading-bot-cli.jsonl",
    );

    const verified = await verifyLocalAuditExport(dir!);
    expect(verified).toEqual({ ok: true });

    const rotor = await buildRotorIngestWire(dir!);
    expect(rotor?.findings).toHaveLength(1);
    expect(rotor?.findings[0]?.evidence.path).toStartWith("tools/audit-evidence/kalshi/");
    expect(rotor?.evidenceCopies[0]?.monorepoPath).toBe(
      monorepoEvidencePath(rotor!.evidenceCopies[0]!.kalshiBotPath),
    );
  });
});
