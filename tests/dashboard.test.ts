// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import { joinPath } from "../src/research/paths.ts";
import {
  handleDashboardHome,
  handleDashboardPulse,
  handleDashboardReport,
  handleDashboardStatus,
  handleDashboardVerifyPost,
  handleRunResearchPost,
} from "../src/agent/dashboard-server.ts";
import { resetDashboardState } from "../src/agent/dashboard-state.ts";
import { parsePulseLine, readPulseLog } from "../src/agent/pulse-log.ts";
import { saveRun } from "../src/research/cache.ts";
import type { ResearchRun } from "../src/research/types.ts";

import { freshTestGeneratedAt, TEST_LATEST_RUN_ID } from "./fixtures.ts";

const FIXTURE_RUN = TEST_LATEST_RUN_ID;

function mockRun(): ResearchRun {
  return {
    runId: FIXTURE_RUN,
    generatedAt: freshTestGeneratedAt(),
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: { discovered: 2, gated: 2, inspected: 2, shortlist: 1 },
    candidates: [],
    gated: [],
    scored: [
      {
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
        },
        score: {
          authApi: 20,
          orderRealism: 20,
          testsCi: 10,
          docsSetup: 10,
          maintenance: 10,
          riskControls: 5,
          licenseModifier: 0,
          total: 75,
        },
        stackRank: 1,
      },
    ],
    shortlist: [],
    excludedSdkOnly: [],
  };
}

describe("pulse-log", () => {
  test("parsePulseLine accepts rotor JSON lines", () => {
    const tick = parsePulseLine(
      '{"ts":"2026-07-22T05:30:37.765Z","ok":true,"findings":2,"concepts":5,"errorCount":0,"errors":[],"elapsedMs":32}',
    );
    expect(tick?.ok).toBe(true);
    expect(tick?.findings).toBe(2);
  });

  test("readPulseLog returns ticks from fixture log", async () => {
    const dir = joinPath(import.meta.dir, ".tmp-pulse");
    await Bun.write(joinPath(dir, "pulse.log"), '{"ts":"t","ok":true,"findings":1,"concepts":1,"errorCount":0,"errors":[],"elapsedMs":1}\n');
    const prev = Bun.env.ROTOR_ROOT;
    Bun.env.ROTOR_ROOT = dir;
    try {
      const ticks = await readPulseLog(5);
      expect(ticks.length).toBe(1);
      expect(ticks[0]?.findings).toBe(1);
    } finally {
      if (prev === undefined) delete Bun.env.ROTOR_ROOT;
      else Bun.env.ROTOR_ROOT = prev;
    }
  });
});

describe("dashboard handlers", () => {
  afterEach(() => {
    resetDashboardState();
  });

  test("handleDashboardHome renders gate miss panel when run has gateMiss", async () => {
    const at = freshTestGeneratedAt();
    const run = mockRun();
    run.generatedAt = at;
    run.shortlist = [];
    run.stats.shortlist = 0;
    run.stats.gated = 0;
    run.gateMiss = {
      rejected: 3,
      nearMisses: [
        {
          fullName: "a/nba-bot",
          stars: 4,
          forks: 1,
          pushedAt: "2026-01-01T00:00:00Z",
          pushedLabel: "2026-01",
          reasons: ["low_popularity"],
          summary: "4 stars, 1 forks — 1 star(s) below min-stars=5",
        },
      ],
      retryCommand: "bun run research -- --dimension=sports-nba --min-stars=4",
      retryHint: "Gate probe",
    };
    saveRun(FIXTURE_RUN, at, run);

    const res = await handleDashboardHome(new Request("http://127.0.0.1:3457/"));
    const html = await res.text();
    expect(html).toContain("Gate miss");
    expect(html).toContain("a/nba-bot");
    expect(html).toContain("--min-stars=4");
    expect(html).toContain("gate-miss-panel");
  });

  test("handleDashboardHome renders shortlist when run exists", async () => {
    const at = freshTestGeneratedAt();
    const run = mockRun();
    run.generatedAt = at;
    run.shortlist = run.scored;
    saveRun(FIXTURE_RUN, at, run);

    const res = await handleDashboardHome(new Request("http://127.0.0.1:3457/"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Kalshi Agent Dashboard");
    expect(html).toContain("OctagonAI/kalshi-trading-bot-cli");
    expect(html).toContain("Run research");
    expect(html).toContain("Verify dashboard");
    expect(html).toContain("dimension-switch");
    expect(html).toContain("operator-nav");
    expect(html).toContain("footer-rate-limit");
    expect(html).toContain("Audit evidence");
  });

  test("handleRunResearchPost uses injected runner with dimension", async () => {
    const res = await handleRunResearchPost(
      new Request("http://127.0.0.1:3457/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dimension: "sports-nba" }),
      }),
      {
        runResearch: async (opts) => {
          const run = mockRun();
          run.runId = "injected-run";
          run.generatedAt = "2099-01-01T00:00:00.000Z";
          run.dimension = opts.dimension ?? "all";
          return run;
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; runId: string };
    expect(body.ok).toBe(true);
    expect(body.runId).toBe("injected-run");

    const status = await handleDashboardStatus();
    const statusBody = (await status.json()) as {
      state: { lastRunId: string; activeDimension: string };
    };
    expect(statusBody.state.lastRunId).toBe("injected-run");
    expect(statusBody.state.activeDimension).toBe("sports-nba");
  });

  test("handleDashboardReport renders markdown workspace", async () => {
    const res = await handleDashboardReport(new Request("http://127.0.0.1:3457/report?dimension=all"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("markdown-body");
    expect(html).toContain("operator-main");
  });

  test("handleDashboardVerifyPost returns check summary", async () => {
    const res = await handleDashboardVerifyPost({
      verifyDashboard: async () => ({
        ok: true,
        dashboardUrl: "http://127.0.0.1:3457",
        checks: [{ id: "api_reachable", ok: true, detail: "ok" }],
        api: null,
        page: null,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; summary: string };
    expect(body.ok).toBe(true);
    expect(body.summary).toContain("PASS");
  });

  test("handleRunResearchPost rejects concurrent runs", async () => {
    const slow = handleRunResearchPost(new Request("http://127.0.0.1:3457/api/research/run", { method: "POST" }), {
      runResearch: () =>
        new Promise<ResearchRun>((resolve) => {
          setTimeout(() => {
            const run = mockRun();
            run.runId = "slow";
            run.generatedAt = "2099-01-01T00:00:00.000Z";
            run.shortlist = [];
            run.stats.shortlist = 0;
            resolve(run);
          }, 50);
        }),
    });
    const second = handleRunResearchPost(new Request("http://127.0.0.1:3457/api/research/run", { method: "POST" }), {
      runResearch: async () => {
        const run = mockRun();
        run.runId = "never";
        return run;
      },
    });
    const [firstRes, secondRes] = await Promise.all([slow, second]);
    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(409);
  });

  test("handleDashboardPulse returns ticks array", async () => {
    const res = await handleDashboardPulse();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticks: unknown[] };
    expect(Array.isArray(body.ticks)).toBe(true);
  });
});
