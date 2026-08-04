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
  resetSportsSourceCatalogCache,
  type RouteRequest,
} from "../src/research/serve.ts";
import { REPORT_DIR, joinPath } from "../src/research/paths.ts";
import { escapeHtml, renderOps, renderRepoPage } from "../src/research/views.ts";

import { freshTestGeneratedAt, mintTestProductionRunId, TEST_LATEST_RUN_ID } from "./fixtures.ts";
import { enterTempCache, exitTempCache } from "./temp-cache.ts";

const RUN_ID = TEST_LATEST_RUN_ID;
/** Older production-shaped id for `?run=` (fixtures are no longer served). */
const OLD_RUN_ID = mintTestProductionRunId(Date.now() - 60_000);

function mockRun(runId: string): ResearchRun {
  return {
    runId,
    kind: "production",
    source: "pipeline",
    generatedAt: runId === RUN_ID ? freshTestGeneratedAt() : new Date(Date.now() - 60_000).toISOString(),
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

function seedLatestRun() {
  const at = freshTestGeneratedAt();
  const run = mockRun(RUN_ID);
  run.generatedAt = at;
  run.shortlist = run.scored;
  saveRun(RUN_ID, at, run);
}

beforeAll(async () => {
  await enterTempCache();
  seedLatestRun();
  saveRun(OLD_RUN_ID, mockRun(OLD_RUN_ID).generatedAt, mockRun(OLD_RUN_ID));
  await Bun.write(joinPath(REPORT_DIR, "latest.md"), "# test report\n");
  await Bun.write(joinPath(REPORT_DIR, "latest.diff.md"), "# diff\n- added foo\n");
});

afterAll(async () => {
  exitTempCache();
  const { restoreCommittedArtifacts } = await import("../tools/restore-committed-artifacts.ts");
  await restoreCommittedArtifacts();
});

describe("serve handlers", () => {
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

describe("ops dashboard", () => {
  const baseOps = {
    generatedAt: new Date().toISOString(),
    agents: { orchestrator: true },
    ticks: [],
    lineMoves: [],
    flows: [],
    runs: [],
  };

  test("renderOps flags canary drift (exit 2) loudly", () => {
    const html = renderOps({
      ...baseOps,
      canary: { at: "2026-07-28T00:00:00Z", exitCode: 2, dryRun: true, watched: 1, polled: 1, upserted: 0, live: 0, errors: 0 },
      store: null,
    });
    expect(html).toContain("DRIFT — exit 2");
    expect(html).toContain("badge bad");
  });

  test("renderOps shows OK badge for clean canary", () => {
    const html = renderOps({
      ...baseOps,
      canary: { at: "2026-07-28T00:00:00Z", exitCode: 0, dryRun: true, watched: 3, polled: 3, upserted: 3, live: 1, errors: 0 },
      store: null,
    });
    expect(html).toContain("badge ok");
    expect(html).toContain(">OK</span>");
  });

  test("renderOps renders event-store counts and missing-table marker", () => {
    const html = renderOps({
      ...baseOps,
      canary: null,
      store: { dbPath: "/tmp/event-store.db", counts: { events: 12, resolutions: 4, book_ticks: -1 } },
    });
    expect(html).toContain("Event store");
    expect(html).toContain("<strong>12</strong> events");
    expect(html).toContain("<strong>4</strong> resolutions");
    expect(html).toContain("<strong>—</strong> book_ticks");
  });

  test("renderOps empty states when no store and no canary", () => {
    const html = renderOps({ ...baseOps, canary: null, store: null });
    expect(html).toContain("No event store");
    expect(html).toContain("No canary artifact");
  });

  test("renderOps badges launchd state", () => {
    const html = renderOps({
      ...baseOps,
      canary: null,
      store: null,
      flows: [
        { label: "f1", logPath: "/tmp/f1.log", lastFireAt: null, lastLines: [], launchdLoaded: false },
        { label: "f2", logPath: "/tmp/f2.log", lastFireAt: null, lastLines: [], launchdLoaded: true },
      ],
    });
    expect(html).toContain("not loaded");
    expect(html).toContain(">loaded</span>");
  });

  test("renderOps renders Server panel with process metrics", () => {
    const html = renderOps({
      ...baseOps,
      canary: null,
      store: null,
      server: {
        bootAt: "2026-07-28T20:00:00.000Z",
        uptimeSec: 125,
        bunVersion: "1.4.0",
        rssMb: 123.456,
        heapUsedMb: 45.678,
        tickCount: 7,
        lineMoveCount: 3,
      },
    });
    expect(html).toContain("<h2>Server</h2>");
    expect(html).toContain('uptime <strong data-f="server.uptimeSec">2m</strong>');
    expect(html).toContain("Bun 1.4.0");
    expect(html).toContain('<strong data-f="server.rssMb">123.5</strong> rss MB');
    expect(html).toContain('<strong data-f="server.heapUsedMb">45.7</strong> heap MB');
    expect(html).toContain('<strong data-f="server.tickCount">7</strong> ticks in DB');
  });

  test("renderOps colors flow staleness against expected period", () => {
    const now = Date.parse(baseOps.generatedAt);
    const html = renderOps({
      ...baseOps,
      canary: null,
      store: null,
      flows: [
        {
          label: "fresh-flow",
          logPath: "/tmp/a.log",
          lastFireAt: new Date(now - 10 * 60_000).toISOString(), // 10m ≤ 2×15m
          lastLines: [],
          launchdLoaded: true,
          periodMin: 15,
        },
        {
          label: "stale-flow",
          logPath: "/tmp/b.log",
          lastFireAt: new Date(now - 3 * 3_600_000).toISOString(), // 3h > 4×30m
          lastLines: [],
          launchdLoaded: true,
          periodMin: 30,
        },
      ],
    });
    expect(html).toContain("fired 10m ago · fresh");
    expect(html).toContain("fired 3h ago · stale");
    expect(html).toContain("fresh ≤2×");
    expect(html).toContain("stale &gt;4×");
  });

  test("renderOps uses in-place refresh: no meta tag, data-f fields tagged", () => {
    const html = renderOps({
      ...baseOps,
      canary: { at: "2026-07-28T00:00:00Z", exitCode: 0, dryRun: true, watched: 1, polled: 1, upserted: 1, live: 0, errors: 0, periodMin: 15 },
      store: null,
      kalshiAuth: { state: "valid", status: 200, checkedAt: "2026-07-28T21:00:00.000Z", cacheTtlSec: 300 },
      server: {
        bootAt: "2026-07-28T20:00:00.000Z",
        uptimeSec: 5,
        bunVersion: "1.4.0",
        rssMb: 40,
        heapUsedMb: 2,
        tickCount: 1,
        lineMoveCount: 0,
      },
      flows: [
        {
          label: "f1",
          logPath: "/tmp/f1.log",
          lastFireAt: "2026-07-28T00:00:00Z",
          lastLines: [],
          launchdLoaded: true,
          periodMin: 15,
        },
      ],
    });
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('data-f="generatedAt"');
    expect(html).toContain('data-f="kalshiAuth.badge"');
    expect(html).toContain('data-f="server.uptimeSec"');
    expect(html).toContain('data-f="server.rssMb"');
    expect(html).toContain('data-f="server.heapUsedMb"');
    expect(html).toContain('data-f="server.tickCount"');
    expect(html).toContain('data-f="server.lineMoveCount"');
    expect(html).toContain('data-f="canary.ageBadge"');
    expect(html).toContain('data-f="flows.0.ageBadge"');
    expect(html).toContain('data-f="flows.0.lastFireAt"');
    expect(html).toContain('id="ops-fetch-state"');
    expect(html).toContain('setInterval(tick, 60000)');
  });

  test("pageLayout still emits meta refresh for pages that opt in", async () => {
    const { pageLayout } = await import("../src/research/views.ts");
    expect(pageLayout("t", "b", { refreshSeconds: 30 })).toContain('<meta http-equiv="refresh" content="30" />');
    expect(pageLayout("t", "b")).not.toContain('http-equiv="refresh"');
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

  test("GET /api/registry/sports-sources returns declaration plus discovery health", async () => {
    resetSportsSourceCatalogCache();
    const res = await fetch(`${server.url}api/registry/sports-sources`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-sports-source-catalog-cache")).toBe("miss");
    const body = await res.json();
    expect(body.schema).toBe("sports-source-catalog/v1");
    expect(body.registry.schema).toBe("sports-source-registry/v1");
    expect(body.registry.integrations).toHaveLength(4);
    expect(["ready", "unavailable", "degraded"]).toContain(body.store.state);

    const cached = await fetch(`${server.url}api/registry/sports-sources`);
    expect(cached.headers.get("cache-control")).toBe("no-store");
    expect(cached.headers.get("x-sports-source-catalog-cache")).toBe("hit");
    expect(await cached.json()).toEqual(body);
  });

  test("GET /registry/sports-sources.json serves the stable declaration artifact", async () => {
    const res = await fetch(`${server.url}registry/sports-sources.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.schema).toBe("sports-source-registry/v1");
    expect(body.integrations).toHaveLength(4);
  });

  test("GET /ops renders dashboard HTML", async () => {
    const res = await fetch(`${server.url}ops`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(text).toContain("Ops dashboard");
    expect(text).toContain("ops.json");
  });

  test("GET /ops.json returns dashboard JSON", async () => {
    const res = await fetch(`${server.url}ops.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generatedAt).toBeDefined();
    expect(body.agents.orchestrator).toBe(true);
    expect(Array.isArray(body.flows)).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
    // temp-cache test env has no event-store.db → store is null, page must still render
    expect(body.store === null || typeof body.store.counts === "object").toBe(true);
  });
});
