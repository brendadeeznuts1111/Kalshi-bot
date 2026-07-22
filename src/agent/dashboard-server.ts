#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/http/server#basic-setup
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { CliOptions } from "../research/cli.ts";
import { runResearch } from "../research/cli.ts";
import { GitHubRateLimitError, serializeGitHubApiError, buildGitHubErrorEnrichment } from "../research/gh.ts";
import { listRunSummaries, loadLatestRunFromDb } from "../research/cache.ts";
import { REPORT_DIR, EVIDENCE_DIR, joinPath } from "../research/paths.ts";
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
} from "./dashboard-state.ts";
import { DASHBOARD_ROUTES, renderDashboardPage } from "./dashboard-views.ts";
import {
  captureDashboardScreenshot,
  loadLatestDashboardScreenshot,
  type CaptureDashboardScreenshotDeps,
  type DashboardScreenshotWire,
  DashboardScreenshotUrlError,
} from "./dashboard-screenshot.ts";
import { pulseLogPath, readPulseLog, pulseLogExists } from "./pulse-log.ts";
import { verificationSummaryForRun } from "./audit-list.ts";

export type DashboardServeOptions = {
  port?: number;
  /** Bind address — default loopback only (never 0.0.0.0). */
  hostname?: string;
};

export type DashboardDeps = {
  runResearch?: (opts: CliOptions) => Promise<{ runId: string; generatedAt: string; shortlist: unknown[] }>;
  captureScreenshot?: CaptureDashboardScreenshotDeps;
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

async function readLatestDiff(): Promise<string | null> {
  const file = Bun.file(joinPath(REPORT_DIR, "latest.diff.md"));
  if (!(await file.exists())) return null;
  const text = await file.text();
  return text.trim() ? text : null;
}

export async function handleDashboardHome(): Promise<Response> {
  const run = loadLatestRunFromDb();
  const diffMd = await readLatestDiff();
  const pulseTicks = await readPulseLog(10);
  const logExists = await pulseLogExists();
  const auditEvidence = await loadLatestDashboardScreenshot();
  return html(
    await renderDashboardPage(run, listRunSummaries(), diffMd, getDashboardState(), pulseTicks, logExists, auditEvidence),
  );
}

export async function handleDashboardStatus(): Promise<Response> {
  const run = loadLatestRunFromDb();
  const ticks = await readPulseLog(1);
  const pulse = ticks.at(-1) ?? null;
  const verification = run ? await verificationSummaryForRun(run) : null;
  return json({
    state: getDashboardState(),
    busy: isResearchBusy(),
    latestRun: run
      ? {
          runId: run.runId,
          generatedAt: run.generatedAt,
          shortlist: run.stats.shortlist,
          gateMiss: run.gateMiss ?? null,
          discoveryMiss: run.discoveryMiss ?? null,
        }
      : null,
    pulse,
    pulseLog: pulseLogPath(),
    verification,
  });
}

export async function handleDashboardPulse(): Promise<Response> {
  return json({ ticks: await readPulseLog(20), logPath: pulseLogPath() });
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

export async function handleRunResearchPost(deps: DashboardDeps = {}): Promise<Response> {
  if (!beginResearch()) {
    return json({ ok: false, error: "Research already running" }, 409);
  }

  const runFn = deps.runResearch ?? runResearch;
  try {
    const run = await runFn({ json: false, exportAudit: true });
    finishResearch(run.runId);
    return json({
      ok: true,
      runId: run.runId,
      shortlist: run.shortlist.length,
      generatedAt: run.generatedAt,
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
      [DASHBOARD_ROUTES.status]: {
        GET: handleDashboardStatus,
      },
      [DASHBOARD_ROUTES.pulse]: {
        GET: handleDashboardPulse,
      },
      [DASHBOARD_ROUTES.runResearch]: {
        POST: () => handleRunResearchPost(deps),
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
