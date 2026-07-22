#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/http/server#basic-setup
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { CliOptions } from "../research/cli.ts";
import { runResearch } from "../research/cli.ts";
import type { ResearchRun } from "../research/types.ts";
import { GitHubRateLimitError, serializeGitHubApiError, buildGitHubErrorEnrichment } from "../research/gh.ts";
import { listRunSummaries, loadLatestRunFromDb } from "../research/cache.ts";
import { runDimension } from "../research/dimensions.ts";
import { EVIDENCE_DIR, joinPath } from "../research/paths.ts";
import { ROUTES } from "../research/patterns.ts";
import {
  handleLatestReport,
  handleRepoPage,
  handleRunApi,
  handleRunsList,
} from "../research/serve.ts";
import {
  beginResearch,
  failResearch,
  finishResearch,
  getDashboardState,
  isResearchBusy,
  resolveDashboardDimension,
} from "./dashboard-state.ts";
import {
  buildDashboardRenderContext,
  DASHBOARD_ROUTES,
  renderDashboardPage,
} from "./dashboard-views.ts";
import { dashboardViewFromPath } from "./dashboard-views-routes.ts";
import {
  captureDashboardScreenshot,
  type CaptureDashboardScreenshotDeps,
  type DashboardScreenshotWire,
  DashboardScreenshotUrlError,
} from "./dashboard-screenshot.ts";
import { pulseLogPath, readPulseLog, pulseLogExists } from "./pulse-log.ts";
import { verificationSummaryForRun } from "./audit-list.ts";
import {
  fetchGitHubRateLimitFootprint,
  formatRateLimitFootprintLine,
  readCacheFallbackFootprint,
} from "./dashboard-telemetry.ts";
import { formatVerifyDashboard, verifyDashboard } from "./verify-dashboard.ts";

export type DashboardServeOptions = {
  port?: number;
  /** Bind address — default loopback only (never 0.0.0.0). */
  hostname?: string;
};

export type DashboardDeps = {
  runResearch?: (opts: CliOptions) => Promise<ResearchRun>;
  captureScreenshot?: CaptureDashboardScreenshotDeps;
  verifyDashboard?: typeof verifyDashboard;
};

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function sharedPulseContext() {
  return {
    pulseTicks: await readPulseLog(10),
    pulseLogPresent: await pulseLogExists(),
  };
}

async function renderViewResponse(req: Request, viewOverride?: ReturnType<typeof dashboardViewFromPath>): Promise<Response> {
  const url = new URL(req.url);
  const view = viewOverride ?? dashboardViewFromPath(url.pathname);
  const dimension = resolveDashboardDimension(url.searchParams.get("dimension"));
  const partial = url.searchParams.get("partial") === "1";
  const pulse = await sharedPulseContext();
  const rateLimit = await fetchGitHubRateLimitFootprint();
  const ctx = await buildDashboardRenderContext({
    view,
    dimension,
    runs: listRunSummaries(),
    ...pulse,
    rateLimit,
  });
  return html(await renderDashboardPage(ctx, { partial }));
}

export async function handleDashboardHome(req: Request): Promise<Response> {
  return renderViewResponse(req, "overview");
}

export async function handleDashboardOverview(req: Request): Promise<Response> {
  return renderViewResponse(req, "overview");
}

export async function handleDashboardReport(req: Request): Promise<Response> {
  return renderViewResponse(req, "report");
}

export async function handleDashboardDiff(req: Request): Promise<Response> {
  return renderViewResponse(req, "diff");
}

export async function handleDashboardBlueprint(req: Request): Promise<Response> {
  return renderViewResponse(req, "blueprint");
}

export async function handleDashboardPulsePage(req: Request): Promise<Response> {
  return renderViewResponse(req, "pulse");
}

export async function handleDashboardStatus(): Promise<Response> {
  const urlDimension = resolveDashboardDimension(null);
  const run = loadLatestRunFromDb({ dimension: urlDimension }) ?? loadLatestRunFromDb();
  const ticks = await readPulseLog(1);
  const pulse = ticks.at(-1) ?? null;
  const verification = run ? await verificationSummaryForRun(run) : null;
  const rateLimit = await fetchGitHubRateLimitFootprint();
  const cache = readCacheFallbackFootprint();
  const pulseLine = pulse
    ? `Pulse: ${pulse.ok ? "ok" : "FAIL"} · ${pulse.findings} findings · ${pulse.ts}`
    : "Pulse: no ticks";

  return json({
    state: getDashboardState(),
    busy: isResearchBusy(),
    activeDimension: getDashboardState().activeDimension,
    latestRun: run
      ? {
          runId: run.runId,
          generatedAt: run.generatedAt,
          shortlist: run.stats.shortlist,
          dimension: runDimension(run),
          gateMiss: run.gateMiss ?? null,
          discoveryMiss: run.discoveryMiss ?? null,
        }
      : null,
    pulse,
    pulseLog: pulseLogPath(),
    verification,
    telemetry: {
      rateLimitLine: formatRateLimitFootprintLine(rateLimit),
      pulseLine,
      cacheLine: cache.degradedHint,
      rateLimit,
      cacheFallback: cache,
    },
  });
}

export async function handleDashboardPulse(): Promise<Response> {
  return json({ ticks: await readPulseLog(20), logPath: pulseLogPath() });
}

export async function handleDashboardVerifyPost(deps: DashboardDeps = {}): Promise<Response> {
  if (isResearchBusy()) {
    return json({ ok: false, error: "Research in progress — try again when idle" }, 409);
  }
  const verifyFn = deps.verifyDashboard ?? verifyDashboard;
  const result = await verifyFn({}, {});
  const summary = formatVerifyDashboard(result);
  return json({
    ok: result.ok,
    summary,
    checks: result.checks,
  }, result.ok ? 200 : 422);
}

export async function handleDashboardScreenshotPost(
  req: Request,
  deps: DashboardDeps = {},
): Promise<Response> {
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      if (body && ("url" in body || "dashboardUrl" in body)) {
        return json({ ok: false, error: "URL parameters are not accepted on /api/screenshot" }, 400);
      }
    } catch {
      // empty body is fine
    }
  }

  try {
    const manifest = await captureDashboardScreenshot({}, deps.captureScreenshot ?? {});
    const wire: DashboardScreenshotWire = {
      ok: true,
      full: manifest.full,
      thumbnail: manifest.thumbnail,
      bytes: manifest.bytes,
      sha256: manifest.sha256,
      image: manifest.image,
      capturedAt: manifest.capturedAt,
    };
    return json(wire);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof DashboardScreenshotUrlError ? 400 : 500;
    return json({ ok: false, error: message }, status);
  }
}

export async function handleEvidenceFile(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const prefix = DASHBOARD_ROUTES.evidencePrefix;
  if (!url.pathname.startsWith(prefix)) {
    return new Response("Not Found", { status: 404 });
  }
  const name = url.pathname.slice(prefix.length);
  if (!name || name.includes("..") || name.includes("/")) {
    return new Response("Bad Request", { status: 400 });
  }
  const file = Bun.file(joinPath(EVIDENCE_DIR, name));
  if (!(await file.exists())) {
    return new Response("Not Found", { status: 404 });
  }
  const type = name.endsWith(".png") ? "image/png" : "application/octet-stream";
  return new Response(file, { headers: { "Content-Type": type } });
}

export async function handleRunResearchPost(req: Request, deps: DashboardDeps = {}): Promise<Response> {
  let dimension: string | undefined;
  if (req.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = (await req.json()) as { dimension?: string };
      dimension = body.dimension;
    } catch {
      // empty body is fine
    }
  }
  const dim = resolveDashboardDimension(dimension ?? null);
  if (!beginResearch(dim)) {
    return json({ ok: false, error: "Research already running" }, 409);
  }

  const runFn = deps.runResearch ?? runResearch;
  try {
    const run = await runFn({ json: false, exportAudit: true, dimension: dim });
    finishResearch(run.runId, runDimension(run));
    return json({
      ok: true,
      runId: run.runId,
      shortlist: run.shortlist.length,
      generatedAt: run.generatedAt,
      dimension: runDimension(run),
    });
  } catch (err) {
    if (err instanceof GitHubRateLimitError) {
      const wire = serializeGitHubApiError(err, buildGitHubErrorEnrichment(err));
      failResearch(wire.message);
      return json({ ok: false, ...wire }, 429);
    }
    const message = err instanceof Error ? err.message : String(err);
    failResearch(message);
    return json({ ok: false, error: message }, 500);
  }
}

export function createDashboardServer(
  options: DashboardServeOptions = {},
  deps: DashboardDeps = {},
) {
  const port = options.port ?? Number(Bun.env.DASHBOARD_PORT ?? 3457);
  const hostname = options.hostname ?? "127.0.0.1";

  return Bun.serve({
    hostname,
    port,
    routes: {
      [DASHBOARD_ROUTES.home]: {
        GET: handleDashboardHome,
      },
      [DASHBOARD_ROUTES.overview]: {
        GET: handleDashboardOverview,
      },
      [DASHBOARD_ROUTES.report]: {
        GET: handleDashboardReport,
      },
      [DASHBOARD_ROUTES.diff]: {
        GET: handleDashboardDiff,
      },
      [DASHBOARD_ROUTES.blueprint]: {
        GET: handleDashboardBlueprint,
      },
      [DASHBOARD_ROUTES.pulse]: {
        GET: handleDashboardPulsePage,
      },
      [DASHBOARD_ROUTES.status]: {
        GET: handleDashboardStatus,
      },
      [DASHBOARD_ROUTES.pulseApi]: {
        GET: handleDashboardPulse,
      },
      [DASHBOARD_ROUTES.runResearch]: {
        POST: (req) => handleRunResearchPost(req, deps),
      },
      [DASHBOARD_ROUTES.verify]: {
        POST: () => handleDashboardVerifyPost(deps),
      },
      [DASHBOARD_ROUTES.screenshot]: {
        POST: (req) => handleDashboardScreenshotPost(req, deps),
      },
      [ROUTES.runsList]: handleRunsList,
      [ROUTES.runApi]: handleRunApi,
      [ROUTES.repo]: handleRepoPage,
      [ROUTES.latestReport]: handleLatestReport,
    },
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith(DASHBOARD_ROUTES.evidencePrefix)) {
        return handleEvidenceFile(req);
      }
      return new Response("Not Found", { status: 404 });
    },
  });
}
