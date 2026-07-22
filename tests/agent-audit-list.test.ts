// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  auditListFromRun,
  buildAuditList,
  buildRotorVerificationIndex,
  formatAuditList,
  fullNameFromKalshiFinding,
  lookupRepoVerification,
  normalizeRepoKey,
  verificationForRepo,
  type AuditCatalogWire,
} from "../src/agent/audit-list.ts";
import type { ResearchRun } from "../src/research/types.ts";

function mockCatalog(): AuditCatalogWire {
  return {
    generated: "2026-07-22T00:00:00.000Z",
    findings: [
      {
        id: "kalshi-repo-octagonai-kalshi-trading-bot-cli",
        kind: "AuditFinding",
        title: "Kalshi bot candidate: OctagonAI/kalshi-trading-bot-cli",
        status: "open",
        meta: { emitter: "kalshi-bot-research", tier: "high-value" },
      },
      {
        id: "kalshi-repo-openfi-dao-kalshi-trading-bot",
        kind: "AuditFinding",
        title: "Kalshi bot candidate: openfi-dao/kalshi-trading-bot",
        status: "open",
        meta: { emitter: "kalshi-bot-research", tier: "watchlist" },
      },
    ],
  };
}

function mockRun(): ResearchRun {
  const scored = (fullName: string, total: number) => ({
    repo: {
      fullName,
      owner: fullName.split("/")[0]!,
      name: fullName.split("/")[1]!,
      htmlUrl: `https://github.com/${fullName}`,
      description: "",
      stars: 10,
      forks: 1,
      pushedAt: "2026-07-22T00:00:00Z",
      archived: false,
      topics: [],
      defaultBranch: "main",
      license: { spdxId: "mit", name: "MIT", preferred: true, unlicensed: false },
    },
    signals: {
      readmeLength: 100,
      hasSetupSection: true,
      hasStrategySection: true,
      authHits: [{ query: "KALSHI-ACCESS-KEY", totalCount: 1, paths: ["src/auth.ts"] }],
      orderHits: [{ query: "create_order", totalCount: 1, paths: ["src/order.ts"] }],
      usesOfficialSdk: true,
      hasAuthInCode: true,
      hasV2Api: true,
      hasRsaPss: false,
      hasLiveOrderPath: true,
      hasDryRunDefault: true,
      hasAuthFreshness: false,
      hasCentsPriceBounds: false,
      hasTests: true,
      hasCi: false,
      languages: { TypeScript: 100 },
      primaryLanguage: "TypeScript",
      lastDefaultBranchCommitAt: "2026-07-22T00:00:00Z",
      strategyTags: ["market_making"],
      isSdkOnly: false,
      riskKeywordHits: [],
    },
    score: {
      authApi: 20,
      orderRealism: 20,
      testsCi: 10,
      docsSetup: 10,
      maintenance: 10,
      riskControls: 5,
      licenseModifier: 0,
      total,
    },
    stackRank: 1,
  });

  return {
    runId: "audit-list-test-run",
    generatedAt: "2026-07-22T00:00:00.000Z",
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: { discovered: 2, gated: 2, inspected: 2, shortlist: 3 },
    candidates: [],
    gated: [],
    scored: [],
    shortlist: [
      scored("OctagonAI/kalshi-trading-bot-cli", 84.75),
      scored("openfi-dao/kalshi-trading-bot", 67.5),
      scored("other/repo", 55),
    ],
    excludedSdkOnly: [],
  };
}

describe("audit-list helpers", () => {
  test("fullNameFromKalshiFinding parses title", () => {
    expect(
      fullNameFromKalshiFinding({
        id: "x",
        kind: "AuditFinding",
        title: "Kalshi bot candidate: openfi-dao/kalshi-trading-bot",
        status: "open",
      }),
    ).toBe("openfi-dao/kalshi-trading-bot");
  });

  test("normalizeRepoKey is case-insensitive", () => {
    expect(normalizeRepoKey("OctagonAI/kalshi-trading-bot-cli")).toBe(
      "octagonai/kalshi-trading-bot-cli",
    );
  });

  test("verificationForRepo marks pulse-verified high-value", () => {
    const v = verificationForRepo(true, "high-value", true);
    expect(v.verified).toBe(true);
    expect(v.verification).toBe("verified");
  });

  test("verificationForRepo marks watchlist without verified", () => {
    const v = verificationForRepo(true, "watchlist", true);
    expect(v.verified).toBe(false);
    expect(v.verification).toBe("watchlist");
  });
});

describe("buildRotorVerificationIndex", () => {
  test("indexes kalshi findings with pulse status", async () => {
    const ctx = await buildRotorVerificationIndex({
      loadCatalog: async () => mockCatalog(),
      latestPulse: async () => ({
        ts: "t",
        ok: true,
        findings: 3,
        concepts: 5,
        errorCount: 0,
        errors: [],
        elapsedMs: 1,
      }),
      readFindingTier: async (id) =>
        id.includes("openfi") ? "watchlist" : "high-value",
    });

    expect(ctx.catalogAvailable).toBe(true);
    const oct = lookupRepoVerification(ctx, "OctagonAI/kalshi-trading-bot-cli");
    expect(oct.verified).toBe(true);
    expect(oct.findingId).toBe("kalshi-repo-octagonai-kalshi-trading-bot-cli");

    const openfi = lookupRepoVerification(ctx, "openfi-dao/kalshi-trading-bot");
    expect(openfi.verification).toBe("watchlist");
    expect(openfi.verified).toBe(false);

    const other = lookupRepoVerification(ctx, "other/repo");
    expect(other.verification).toBe("unverified");
  });

  test("warns when catalog missing", async () => {
    const ctx = await buildRotorVerificationIndex({
      loadCatalog: async () => null,
      latestPulse: async () => null,
    });
    expect(ctx.catalogAvailable).toBe(false);
    expect(ctx.warning).toContain("not found");
  });
});

describe("auditListFromRun", () => {
  test("formats table output with verification badges", async () => {
    const run = mockRun();
    const result = await auditListFromRun(run, {
      deps: {
        loadCatalog: async () => mockCatalog(),
        latestPulse: async () => ({
          ts: "t",
          ok: true,
          findings: 3,
          concepts: 5,
          errorCount: 0,
          errors: [],
          elapsedMs: 1,
        }),
        readFindingTier: async (id) =>
          id.includes("openfi") ? "watchlist" : "high-value",
      },
    });

    expect(result.entries.length).toBe(3);
    expect(result.entries[0]?.verified).toBe(true);
    expect(result.entries[1]?.verification).toBe("watchlist");
    expect(result.entries[2]?.verification).toBe("unverified");

    const text = formatAuditList(result);
    expect(text).toContain("OctagonAI/kalshi-trading-bot-cli");
    expect(text).toContain("verified");
    expect(text).toContain("watchlist");
  });

  test("filters by repo", async () => {
    const run = mockRun();
    const result = await auditListFromRun(run, {
      repo: "openfi-dao/kalshi-trading-bot",
      deps: {
        loadCatalog: async () => mockCatalog(),
        latestPulse: async () => null,
        readFindingTier: async () => "watchlist",
      },
    });
    expect(result.entries.length).toBe(1);
    expect(result.entries[0]?.fullName).toBe("openfi-dao/kalshi-trading-bot");
  });
});

describe("buildAuditList", () => {
  test("works with prebuilt context", () => {
    const ctx = {
      byRepo: new Map([
        [
          normalizeRepoKey("OctagonAI/kalshi-trading-bot-cli"),
          {
            verified: true,
            verification: "verified" as const,
            findingId: "kalshi-repo-octagonai-kalshi-trading-bot-cli",
            inCatalog: true,
            pulseOk: true,
            exportTier: "high-value" as const,
          },
        ],
      ]),
      catalogAvailable: true,
      catalogGenerated: "2026-07-22T00:00:00.000Z",
      pulseOk: true,
      warning: null,
    };
    const result = buildAuditList(mockRun(), ctx);
    expect(result.entries[0]?.findingId).toBe("kalshi-repo-octagonai-kalshi-trading-bot-cli");
  });
});
