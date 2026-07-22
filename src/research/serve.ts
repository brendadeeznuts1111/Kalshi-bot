#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/http/server#basic-setup
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { ResearchRun, ScoredRepo } from "./types.ts";
import { listRunSummaries, loadLatestRunFromDb, loadRunFromDb } from "./cache.ts";
import { REPORT_DIR, joinPath } from "./paths.ts";
import { fullNameFromRouteParams, ROUTES } from "./patterns.ts";
import { pageLayout, renderIndex, renderRepoPage } from "./views.ts";

export type ServeOptions = {
  port?: number;
};

export type RouteRequest<P extends Record<string, string>> = {
  params: P;
  url: string;
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

function findScored(run: ResearchRun, fullName: string): ScoredRepo | undefined {
  return run.scored.find((s) => s.repo.fullName === fullName);
}

async function readLatestDiff(): Promise<string | null> {
  const file = Bun.file(joinPath(REPORT_DIR, "latest.diff.md"));
  if (!(await file.exists())) return null;
  const text = await file.text();
  return text.trim() ? text : null;
}

function resolveRun(runId: string | null): ResearchRun | null {
  if (runId) return loadRunFromDb(runId);
  return loadLatestRunFromDb();
}

export async function handleHome(): Promise<Response> {
  const run = loadLatestRunFromDb();
  if (!run) {
    return html(
      pageLayout(
        "Kalshi Bot Research",
        "<p>No research runs yet. Run <code>bun run research</code> first.</p>",
      ),
      503,
    );
  }

  const diffMd = await readLatestDiff();
  return html(renderIndex(run, listRunSummaries(), diffMd));
}

export function handleRunsList(): Response {
  return json({ runs: listRunSummaries() });
}

export function handleRunApi(req: RouteRequest<{ id: string }>): Response {
  const run = loadRunFromDb(req.params.id);
  if (!run) return json({ error: "run not found" }, 404);
  return json(run);
}

export function handleRepoPage(req: RouteRequest<{ owner: string; name: string }>): Response {
  const runId = new URL(req.url).searchParams.get("run");
  const run = resolveRun(runId);
  if (!run) {
    return html(pageLayout("Repo", "<p>No research runs yet.</p>"), 503);
  }

  let fullName: string;
  try {
    fullName = fullNameFromRouteParams(req.params.owner, req.params.name);
  } catch {
    return html(pageLayout("Repo", "<p>Invalid repo path.</p>"), 400);
  }

  const item = findScored(run, fullName);
  if (!item) {
    return html(
      pageLayout("Repo", `<p>Repo not in run <code>${run.runId}</code>: ${fullName}</p>`),
      404,
    );
  }
  return html(renderRepoPage(item, run));
}

export async function handleLatestReport(): Promise<Response> {
  const file = Bun.file(joinPath(REPORT_DIR, "latest.md"));
  if (!(await file.exists())) {
    return new Response("Report not found. Run `bun run research` first.", { status: 404 });
  }
  return new Response(file, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function createResearchServer(options: ServeOptions = {}) {
  const port = options.port ?? Number(Bun.env.PORT ?? 3456);
  return Bun.serve({
    port,
    routes: {
      [ROUTES.home]: handleHome,
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

if (import.meta.main) {
  const server = createResearchServer();
  console.log(`Research browser at ${server.url}`);
}
