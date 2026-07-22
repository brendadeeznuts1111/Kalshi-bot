// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { formatAgentStatus, getAgentStatus } from "../src/agent/agent-status.ts";
import {
  parseAgentCommand,
  stripBareDoubleDashes,
  stripLeadingDoubleDashes,
} from "../src/agent/cli.ts";
import {
  formatLift,
  suggestLiftFromRun,
  attachPatternsToLift,
} from "../src/agent/lift.ts";
import type { RepoPatternReport } from "../src/agent/pattern-extract.ts";
import { emptyPatternHits } from "../src/agent/pattern-extract.ts";
import { saveRun } from "../src/research/cache.ts";
import type { ResearchRun } from "../src/research/types.ts";
import { freshTestGeneratedAt, mintTestProductionRunId } from "./fixtures.ts";

function mockRun(): ResearchRun {
  const base = {
    repo: {
      fullName: "OctagonAI/kalshi-trading-bot-cli",
      owner: "OctagonAI",
      name: "kalshi-trading-bot-cli",
      htmlUrl: "https://github.com/OctagonAI/kalshi-trading-bot-cli",
      description: "Kalshi trading bot CLI",
      stars: 42,
      forks: 10,
      pushedAt: new Date().toISOString(),
      archived: false,
      topics: [],
      defaultBranch: "main",
      license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
    },
    signals: {
      readmeLength: 100,
      hasSetupSection: true,
      hasStrategySection: true,
      authHits: [],
      orderHits: [],
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
      lastDefaultBranchCommitAt: null,
      strategyTags: ["market_making"],
      isSdkOnly: false,
      riskKeywordHits: [],
    hasFeeAware: false,
    feeAwareKeywordHits: [],
    },
    stackRank: 1,
  };

  return {
    runId: "agent-test-run",
    generatedAt: "2099-06-01T00:00:00.000Z",
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: { discovered: 2, gated: 2, inspected: 2, shortlist: 2 },
    candidates: [],
    gated: [],
    scored: [
      {
        ...base,
        score: {
          authApi: 22,
          orderRealism: 20,
          testsCi: 12,
          docsSetup: 10,
          maintenance: 8,
          riskControls: 6,
          licenseModifier: 0,
          total: 78,
        },
      },
      {
        ...base,
        repo: {
          ...base.repo,
          fullName: "openfi-dao/kalshi-trading-bot",
          owner: "openfi-dao",
          name: "kalshi-trading-bot",
          htmlUrl: "https://github.com/openfi-dao/kalshi-trading-bot",
          license: { spdxId: null, name: null, preferred: false, unlicensed: true },
        },
        score: {
          authApi: 18,
          orderRealism: 22,
          testsCi: 8,
          docsSetup: 12,
          maintenance: 5,
          riskControls: 4,
          licenseModifier: -15,
          total: 54,
        },
      },
    ],
    shortlist: [],
    excludedSdkOnly: [],
  };
}

describe("agent cli", () => {
  test("parseAgentCommand recognizes subcommands", () => {
    expect(parseAgentCommand(["status", "--json"]).command).toBe("status");
    expect(parseAgentCommand(["patterns", "--dimension=market-making"]).command).toBe("patterns");
    expect(parseAgentCommand(["blueprint"]).command).toBe("blueprint");
    expect(parseAgentCommand(["audit-list", "--json"]).command).toBeNull();
    expect(parseAgentCommand([]).command).toBeNull();
  });

  test("stripBareDoubleDashes removes leading and mid-argv bare --", () => {
    expect(stripLeadingDoubleDashes(["--", "--dimension=market-making"])).toEqual([
      "--dimension=market-making",
    ]);
    expect(stripBareDoubleDashes(["--json", "--", "--dimension=market-making"])).toEqual([
      "--json",
      "--dimension=market-making",
    ]);
    expect(parseAgentCommand(["status", "--", "--dimension=market-making"]).rest).toEqual([
      "--dimension=market-making",
    ]);
    expect(parseAgentCommand(["status", "--json", "--", "--dimension=mm"]).rest).toEqual([
      "--json",
      "--dimension=mm",
    ]);
  });

  test("suggestLiftFromRun picks best repo per component", () => {
    const run = mockRun();
    run.shortlist = run.scored;
    const result = suggestLiftFromRun(run);
    expect(result.recommendations.find((r) => r.component === "authApi")?.repo).toBe(
      "OctagonAI/kalshi-trading-bot-cli",
    );
    expect(result.recommendations.find((r) => r.component === "orderRealism")?.repo).toBe(
      "openfi-dao/kalshi-trading-bot",
    );
    expect(result.notes.some((n) => n.includes("License warning"))).toBe(true);
    expect(formatLift(result)).toContain("Lift map:");
  });

  test("attachPatternsToLift adds pattern refs from injected loader", async () => {
    const run = mockRun();
    run.shortlist = run.scored;
    const base = suggestLiftFromRun(run);
    const mockRepoPatterns: RepoPatternReport = {
      fullName: "OctagonAI/kalshi-trading-bot-cli",
      score: 78,
      verification: "high-value",
      evidencePaths: ["src/tools/kalshi/api.ts"],
      summary: { ...emptyPatternHits(), auth: ["rsa-pss-signing", "kalshi-access-headers"] },
      files: [
        {
          path: "src/tools/kalshi/api.ts",
          components: ["authApi"],
          hits: {
            ...emptyPatternHits(),
            auth: ["rsa-pss-signing", "kalshi-access-headers"],
          },
          excerpt: "KALSHI-ACCESS-SIGNATURE",
          fetchOk: true,
        },
      ],
    };
    const enriched = await attachPatternsToLift(base, run, async (_dim, repo) =>
      repo === "OctagonAI/kalshi-trading-bot-cli" ? mockRepoPatterns : null,
    );
    const authRec = enriched.recommendations.find((r) => r.component === "authApi");
    expect(authRec?.pattern?.summary).toContain("RSA-PSS");
    expect(authRec?.pattern?.file).toBe("src/tools/kalshi/api.ts");
    expect(formatLift(enriched)).toContain("↳ pattern:");
  });

  test("getAgentStatus reads newest production run across dimensions", async () => {
    const { withTempCache } = await import("./temp-cache.ts");
    await withTempCache(async () => {
      const run = mockRun();
      const at = freshTestGeneratedAt();
      run.runId = mintTestProductionRunId();
      run.generatedAt = at;
      run.kind = "production";
      run.source = "pipeline";
      run.dimension = "market-making";
      run.shortlist = run.scored;
      saveRun(run.runId, at, run);

      const status = getAgentStatus();
      expect(status.source).toBe("cache.db");
      expect(status.latestRun?.runId).toBe(run.runId);
      expect(status.latestRun?.dimension).toBe("market-making");
      expect(formatAgentStatus(status)).toContain("cache.db");
    });
  });

  test("getAgentStatus with dimension does not cross-fallback", () => {
    const status = getAgentStatus("dimension-that-does-not-exist-zz");
    expect(status.latestRun).toBeNull();
    expect(status.requestedDimension).toBe("dimension-that-does-not-exist-zz");
    expect(formatAgentStatus(status)).toContain("none for dimension=");
    expect(formatAgentStatus(status)).toContain(
      "bun run research -- --dimension=dimension-that-does-not-exist-zz",
    );
    expect(formatAgentStatus(status)).toContain(
      "bun run agent ground --dimension=dimension-that-does-not-exist-zz",
    );
    expect(formatAgentStatus(status)).toContain("research:dry");
  });

  test("parseAgentCommand recognizes ground", () => {
    expect(parseAgentCommand(["ground"]).command).toBe("ground");
  });
});
