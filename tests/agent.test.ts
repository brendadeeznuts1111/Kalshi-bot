// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import {
  captureEvidence,
  normalizeCaptureUrl,
  sha3HexBytes,
} from "../src/agent/capture-evidence.ts";
import {
  formatAgentStatus,
  getAgentStatus,
} from "../src/agent/dashboard-client.ts";
import { resetDashboardState } from "../src/agent/dashboard-state.ts";
import {
  parseAgentCommand,
  runAgentSuggestLift,
} from "../src/agent/cli.ts";
import {
  formatSuggestLift,
  suggestLiftFromRun,
  attachPatternsToLift,
} from "../src/agent/suggest-lift.ts";
import type { RepoPatternReport } from "../src/agent/pattern-extract.ts";
import { emptyPatternHits } from "../src/agent/pattern-extract.ts";
import { saveRun } from "../src/research/cache.ts";
import type { ResearchRun } from "../src/research/types.ts";
import { freshTestGeneratedAt, TEST_LATEST_RUN_ID } from "./fixtures.ts";

function mockRun(): ResearchRun {
  const base = {
    repo: {
      fullName: "OctagonAI/kalshi-trading-bot-cli",
      owner: "OctagonAI",
      name: "kalshi-trading-bot-cli",
      htmlUrl: "https://github.com/OctagonAI/kalshi-trading-bot-cli",
      description: "test",
      stars: 100,
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
      hasTests: true,
      hasCi: false,
      languages: { TypeScript: 100 },
      primaryLanguage: "TypeScript",
      lastDefaultBranchCommitAt: null,
      strategyTags: ["market_making"],
      isSdkOnly: false,
      riskKeywordHits: [],
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
  afterEach(() => {
    resetDashboardState();
  });

  test("parseAgentCommand recognizes subcommands", () => {
    expect(parseAgentCommand(["status", "--json"]).command).toBe("status");
    expect(parseAgentCommand(["audit-list", "--json"]).command).toBe("audit-list");
    expect(parseAgentCommand(["patterns", "--dimension=market-making"]).command).toBe("patterns");
    expect(parseAgentCommand(["capture-evidence", "--url=x"]).command).toBe("capture-evidence");
    expect(parseAgentCommand([]).command).toBeNull();
  });

  test("normalizeCaptureUrl builds kalshi market URL", () => {
    expect(normalizeCaptureUrl("FOO-BAR")).toBe("https://kalshi.com/markets/FOO-BAR");
    expect(normalizeCaptureUrl("https://example.com/x")).toBe("https://example.com/x");
  });

  test("sha3HexBytes is stable", () => {
    const a = sha3HexBytes(new TextEncoder().encode("abc"));
    const b = sha3HexBytes(new TextEncoder().encode("abc"));
    expect(a).toBe(b);
    expect(a.length).toBe(64);
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
    expect(result.recommendations[0]?.verification).toBe("unverified");
    expect(result.notes.some((n) => n.includes("License warning"))).toBe(true);
    expect(formatSuggestLift(result)).toContain("Lift map:");
  });

  test("attachPatternsToLift adds pattern refs from injected loader", async () => {
    const run = mockRun();
    run.shortlist = run.scored;
    const base = suggestLiftFromRun(run);
    const mockRepoPatterns: RepoPatternReport = {
      fullName: "OctagonAI/kalshi-trading-bot-cli",
      score: 78,
      verification: "✗ unverified",
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
    expect(formatSuggestLift(enriched)).toContain("↳ pattern:");
  });

  test("runAgentSuggestLift prints JSON", async () => {
    const run = mockRun();
    run.shortlist = run.scored;
    saveRun(run.runId, run.generatedAt, run);

    const logs: string[] = [];
    const orig = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      expect(await runAgentSuggestLift(true, run.runId)).toBe(0);
      const parsed = JSON.parse(logs.join("\n")) as { runId: string };
      expect(parsed.runId).toBe(run.runId);
    } finally {
      console.log = orig;
    }
  });

  test("getAgentStatus falls back to local", async () => {
    const run = mockRun();
    const at = freshTestGeneratedAt();
    run.runId = TEST_LATEST_RUN_ID;
    run.generatedAt = at;
    run.shortlist = run.scored;
    saveRun(run.runId, at, run);

    Bun.env.DASHBOARD_URL = "http://127.0.0.1:1";
    try {
      const status = await getAgentStatus();
      expect(status.source).toBe("local");
      expect(status.latestRun?.runId).toBe(run.runId);
      expect(formatAgentStatus(status)).toContain("local");
    } finally {
      delete Bun.env.DASHBOARD_URL;
    }
  });

  test("captureEvidence writes manifest with injected capture", async () => {
    const outDir = `${import.meta.dir}/.tmp-capture`;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const manifest = await captureEvidence(
      { url: "https://kalshi.com/markets/test-market", outDir, slug: "test-capture" },
      {
        navigateAndCapture: async () => ({ png, title: "Test Market" }),
      },
    );
    expect(manifest.digest).toBe(sha3HexBytes(png));
    expect(manifest.title).toBe("Test Market");
    expect(await Bun.file(manifest.imagePath).exists()).toBe(true);
  });
});
