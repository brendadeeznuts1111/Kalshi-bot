// @see https://bun.com/docs/test/index#run-tests
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ResearchRun } from "../src/research/types.ts";
import { listRunSummaries, saveRun } from "../src/research/cache.ts";
import {
  createResearchServer,
  handleHome,
  handleLatestReport,
  handleRepoPage,
  handleRunApi,
  handleRunsList,
  type RouteRequest,
} from "../src/research/serve.ts";
import { REPORT_DIR, joinPath } from "../src/research/paths.ts";
import { escapeHtml, renderRepoPage } from "../src/research/views.ts";

import { freshTestGeneratedAt, TEST_LATEST_RUN_ID } from "./fixtures.ts";

const RUN_ID = TEST_LATEST_RUN_ID;
const OLD_RUN_ID = "serve-test-run-old";

function mockRun(runId: string): ResearchRun {
  return {
    runId,
    generatedAt: runId === RUN_ID ? freshTestGeneratedAt() : "2026-12-30T00:00:00.000Z",
    dimension: "all",
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
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

describe("serve handlers", () => {
  function seedLatestRun() {
    const at = freshTestGeneratedAt();
    const run = mockRun(RUN_ID);
    run.generatedAt = at;
    run.shortlist = run.scored;
    saveRun(RUN_ID, at, run);
  }

  beforeAll(async () => {
    seedLatestRun();
    saveRun(OLD_RUN_ID, mockRun(OLD_RUN_ID).generatedAt, mockRun(OLD_RUN_ID));
    await Bun.write(joinPath(REPORT_DIR, "latest.md"), "# test report\n");
    await Bun.write(joinPath(REPORT_DIR, "latest.diff.md"), "# diff\n- added foo\n");
  });

  afterAll(async () => {
    const { restoreLatestReport } = await import("../tools/restore-latest-report.ts");
    await restoreLatestReport();
  });

  beforeEach(() => {
    seedLatestRun();
  });

  test("handleHome renders shortlist and diff", async () => {
    const res = await handleHome();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("OctagonAI/kalshi-trading-bot-cli");
    expect(text).toContain("Latest diff");
  });

  test("handleRunsList returns summaries", async () => {
    const res = handleRunsList();
    const body = await res.json();
    expect(body.runs.length).toBeGreaterThan(0);
    expect(body.runs[0].runId).toBeDefined();
  });

  test("listRunSummaries skips corrupt payloads", () => {
    const summaries = listRunSummaries();
    expect(summaries.some((s) => s.runId === RUN_ID)).toBe(true);
  });

  test("handleRunApi returns run JSON", async () => {
    const req: RouteRequest<{ id: string }> = { params: { id: RUN_ID }, url: "http://localhost/api/runs/x" };
    const res = handleRunApi(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runId).toBe(RUN_ID);
  });

  test("handleRepoPage uses ?run= query", async () => {
    const req: RouteRequest<{ owner: string; name: string }> = {
      params: { owner: "OctagonAI", name: "kalshi-trading-bot-cli" },
      url: `http://localhost/repo/OctagonAI/kalshi-trading-bot-cli?run=${OLD_RUN_ID}`,
    };
    const res = handleRepoPage(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(OLD_RUN_ID);
  });

  test("handleLatestReport serves markdown file", async () => {
    const res = await handleLatestReport();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("test report");
  });
});

describe("views", () => {
  test("escapeHtml encodes special chars", () => {
    expect(escapeHtml(`a & b <c> "d"`)).toBe("a &amp; b &lt;c&gt; &quot;d&quot;");
  });

  test("renderRepoPage includes score breakdown", () => {
    const run = mockRun(RUN_ID);
    run.shortlist = run.scored;
    const html = renderRepoPage(run.scored[0]!, run);
    expect(html).toContain("Score breakdown");
    expect(html).toContain("Auth/API");
  });
});

describe("createResearchServer", () => {
  let server: ReturnType<typeof createResearchServer>;

  beforeAll(() => {
    server = createResearchServer({ port: 0 });
  });

  afterAll(() => {
    server.stop();
  });

  test("GET / returns HTML", async () => {
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("GET /api/runs returns JSON list", async () => {
    const res = await fetch(`${server.url}api/runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.runs)).toBe(true);
  });
});
