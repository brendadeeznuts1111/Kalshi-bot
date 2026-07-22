#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/http/server#basic-setup
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { CliOptions } from "../research/cli.ts";
import { runResearch } from "../research/cli.ts";
import { GitHubRateLimitError, serializeGitHubApiError, buildGitHubErrorEnrichment } from "../research/gh.ts";
import { listRunSummaries, loadLatestRunFromDb } from "../research/cache.ts";
import { REPORT_DIR, joinPath } from "../research/paths.ts";
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
import { pulseLogPath, readPulseLog, pulseLogExists, resolveRotorRoot } from "./pulse-log.ts";
import { verificationSummaryForRun } from "./audit-list.ts";

export type DashboardServeOptions = {
  port?: number;
};

export type DashboardDeps = {
  runResearch?: (opts: CliOptions) => Promise<{ runId: string; generatedAt: string; shortlist: unknown[] }>;
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
  return html(
    renderDashboardPage(run, listRunSummaries(), diffMd, getDashboardState(), pulseTicks, logExists),
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
      ? { runId: run.runId, generatedAt: run.generatedAt, shortlist: run.stats.shortlist }
      : null,
    pulse,
    pulseLog: pulseLogPath(),
    verification,
  });
}

export async function handleDashboardPulse(): Promise<Response> {
  return json({ ticks: await readPulseLog(20), logPath: pulseLogPath() });
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

  return Bun.serve({
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
      [ROUTES.runsList]: handleRunsList,
      [ROUTES.runApi]: handleRunApi,
      [ROUTES.repo]: handleRepoPage,
      [ROUTES.latestReport]: handleLatestReport,
    },
    fetch(req) {
      return new Response("Not Found", { status: 404 });
    },
  });
}
