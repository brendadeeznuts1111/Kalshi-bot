// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { handleDashboardHome } from "../src/agent/dashboard-server.ts";
import { renderAgentDashboardMeta } from "../src/agent/dashboard-views.ts";
import {
  evaluateVerifyChecks,
  verifyDashboard,
} from "../src/agent/verify-dashboard.ts";
import type { AgentStatusPayload } from "../src/agent/dashboard-client.ts";
import { saveRun } from "../src/research/cache.ts";
import type { ResearchRun } from "../src/research/types.ts";
import { freshTestGeneratedAt, TEST_LATEST_RUN_ID } from "./fixtures.ts";

function mockRun(): ResearchRun {
  return {
    runId: TEST_LATEST_RUN_ID,
    generatedAt: freshTestGeneratedAt(),
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: { discovered: 10, gated: 8, inspected: 6, shortlist: 3 },
    candidates: [],
    gated: [],
    scored: [],
    shortlist: [
      {
        repo: {
          fullName: "OctagonAI/kalshi-trading-bot-cli",
          owner: "OctagonAI",
          name: "kalshi-trading-bot-cli",
          htmlUrl: "https://github.com/OctagonAI/kalshi-trading-bot-cli",
          description: null,
          stars: 1,
          forks: 1,
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
          lastDefaultBranchCommitAt: "2026-01-01T00:00:00Z",
          strategyTags: ["market_making"],
          isSdkOnly: false,
          riskKeywordHits: [],
        },
        score: { authApi: 1, orderRealism: 1, testsCi: 1, docsSetup: 1, maintenance: 1, riskControls: 1, licenseModifier: 0, total: 80 },
        stackRank: 1,
      },
    ],
    excludedSdkOnly: [],
  };
}

function mockApi(overrides: Partial<AgentStatusPayload> = {}): AgentStatusPayload {
  const run = mockRun();
  return {
    source: "dashboard-api",
    dashboardUrl: "http://127.0.0.1:3457",
    state: { phase: "idle", message: null, startedAt: null, finishedAt: null, lastRunId: run.runId },
    busy: false,
    latestRun: {
      runId: run.runId,
      generatedAt: run.generatedAt,
      shortlist: run.stats.shortlist,
    },
    pulse: {
      ts: new Date().toISOString(),
      ok: true,
      findings: 2,
      concepts: 5,
      errorCount: 0,
      errors: [],
      elapsedMs: 32,
    },
    pulseLog: "/tmp/pulse.log",
    verification: null,
    ...overrides,
  };
}

describe("verify-dashboard", () => {
  test("renderAgentDashboardMeta is embedded in dashboard HTML", async () => {
    const run = mockRun();
    saveRun(run.runId, run.generatedAt, run);
    const res = await handleDashboardHome();
    const html = await res.text();
    expect(html).toContain('id="agent-dashboard-meta"');
    expect(html).toContain(run.runId);
    expect(renderAgentDashboardMeta(run)).toContain(run.generatedAt);
  });

  test("evaluateVerifyChecks passes when API and page agree", () => {
    const api = mockApi();
    const page = {
      title: "Kalshi Agent Dashboard",
      h1: "Kalshi Agent Dashboard",
      meta: {
        runId: api.latestRun!.runId,
        generatedAt: api.latestRun!.generatedAt,
        shortlist: 3,
        stats: { shortlist: 3 },
      },
      hasRunButton: true,
      bannerClass: "banner ok",
      bannerText: "Ready.",
    };
    const checks = evaluateVerifyChecks(api, page, { maxAgeDays: 21 });
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  test("evaluateVerifyChecks fails on run_id mismatch", () => {
    const api = mockApi();
    const page = {
      title: "Kalshi Agent Dashboard",
      h1: "Kalshi Agent Dashboard",
      meta: {
        runId: "stale-run",
        generatedAt: api.latestRun!.generatedAt,
        shortlist: 3,
        stats: { shortlist: 3 },
      },
      hasRunButton: true,
      bannerClass: "banner ok",
      bannerText: "Ready.",
    };
    const checks = evaluateVerifyChecks(api, page);
    const parity = checks.find((c) => c.id === "run_id_parity");
    expect(parity?.ok).toBe(false);
  });

  test("verifyDashboard uses injected deps", async () => {
    const api = mockApi();
    const page = {
      title: "Kalshi Agent Dashboard",
      h1: "Kalshi Agent Dashboard",
      meta: {
        runId: api.latestRun!.runId,
        generatedAt: api.latestRun!.generatedAt,
        shortlist: 3,
        stats: { shortlist: 3 },
      },
      hasRunButton: true,
      bannerClass: "banner ok",
      bannerText: "Ready.",
    };
    const result = await verifyDashboard({}, {
      fetchStatus: async () => api,
      probePage: async () => page,
    });
    expect(result.ok).toBe(true);
  });

  test("verifyDashboard fails when dashboard API is down", async () => {
    const result = await verifyDashboard({}, {
      fetchStatus: async () => null,
      probePage: async () => {
        throw new Error("skipped");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.id === "api_reachable")?.ok).toBe(false);
  });
});
