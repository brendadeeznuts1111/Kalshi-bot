// @ts-nocheck
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { ResearchRun, ScoredRepo } from "./types.ts";
import {
  isFixtureRun,
  listRunSummaries,
  loadLatestProductionRunAnyDimension,
  loadRunFromDb,
} from "./cache.ts";
import { REPORT_DIR, CACHE_DIR, joinPath } from "./paths.ts";
import { fullNameFromRouteParams, ROUTES } from "./patterns.ts";
import { pageLayout, renderIndex, renderOps, renderRepoPage } from "./views.ts";
import { Database } from "bun:sqlite";
import { partnerDetailHandler } from "../regulatory/routes/ops/partners";
import { requireStateCompliance } from "../regulatory/middleware/state-compliance";
import { createRateLimiter } from "../regulatory/middleware/rate-limit";
import { createStateValidator } from "../regulatory/middleware/state-validator";
import {
  AgentOrchestrator,
  ComplianceAgent,
  OpsAgent,
  MarketDataAgent,
  AdminAgent,
} from "../regulatory/agents";
import { ComplianceRepository, ViolationAlerts } from "../regulatory";

// ── Regulatory compliance integration ──
const REG_DB_PATH = process.env.REGULATORY_DB ?? ":memory:";
const regDb = new Database(REG_DB_PATH);

// Bootstrap schema if in-memory
if (REG_DB_PATH === ":memory:") {
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const migration011 = readFileSync(
    join(import.meta.dir, "../regulatory/db/migrations/011_state_regulation.sql"),
    "utf-8",
  );
  const migration012 = readFileSync(
    join(import.meta.dir, "../regulatory/db/migrations/012_polymarket.sql"),
    "utf-8",
  );
  const seeds = readFileSync(
    join(import.meta.dir, "../regulatory/db/seeds/state_regulations.sql"),
    "utf-8",
  );
  regDb.exec(migration011);
  regDb.exec(migration012);
  regDb.exec(seeds);
}

// ── Agent team bootstrap ──
const complianceRepo = new ComplianceRepository(regDb);
const violationAlerts = new ViolationAlerts(regDb);
const orchestrator = new AgentOrchestrator();
orchestrator.register(new ComplianceAgent(complianceRepo));
orchestrator.register(new OpsAgent(violationAlerts));
orchestrator.register(new MarketDataAgent(regDb));
orchestrator.register(new AdminAgent(regDb));

const complianceGate = requireStateCompliance(regDb);
const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 100 });
const stateValidator = createStateValidator({ allowed: ["MA", "NJ"] });

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

/** Latest production run across dimensions (matches `agent status` — no fixture fallback). */
function resolveLatestRun(): ResearchRun | null {
  return loadLatestProductionRunAnyDimension();
}

function resolveRun(runId: string | null): ResearchRun | null {
  if (runId) {
    const run = loadRunFromDb(runId);
    if (!run || isFixtureRun(run)) return null;
    return run;
  }
  return resolveLatestRun();
}

export async function handleHome(): Promise<Response> {
  const run = resolveLatestRun();
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
  if (!run || isFixtureRun(run)) return json({ error: "run not found" }, 404);
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

// ── Regulatory route handlers ──
function handlePartnerDetail(req: Request): Response {
  const url = new URL(req.url);
  const nodeId = url.pathname.split("/").pop()!;
  const filters = {
    state: url.searchParams.get("state") ?? undefined,
    sport: url.searchParams.get("sport") ?? undefined,
    market: url.searchParams.get("market") ?? undefined,
  };
  return partnerDetailHandler(regDb, nodeId, filters);
}

async function handlePlaceBet(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const ctx = (req as any).compliance;
  return json({
    ok: true,
    playId: ctx?.playId ?? `play-${Date.now()}`,
    stateCode: ctx?.stateCode,
    userId: ctx?.userId,
    wager: body.wagerAmount,
  });
}

// ── Polymarket / agent route handlers ──

async function handlePolymarketIngest(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slugs = body.slugs ? (body.slugs as string[]) : undefined;
  const limit = body.limit ? Number(body.limit) : undefined;

  const result = await orchestrator.dispatch(
    { type: "MARKET_INGEST", payload: { slugs, fetchLimit: limit } },
    { db: regDb, now: Date.now(), traceId: `req-${Date.now()}` },
  );

  return json(result);
}

async function handlePolymarketStatus(_req: Request): Promise<Response> {
  const marketDataAgent = orchestrator.listRoles().includes("market_data");
  const complianceAgent = orchestrator.listRoles().includes("compliance");
  const opsAgent = orchestrator.listRoles().includes("ops");

  return json({
    service: "polymarket-regulatory-bridge",
    agents: {
      market_data: marketDataAgent,
      compliance: complianceAgent,
      ops: opsAgent,
      admin: orchestrator.listRoles().includes("admin"),
      orchestrator: true,
    },
    endpoints: [
      "POST /polymarket/ingest",
      "GET /polymarket/status",
      "GET /polymarket/ticks",
      "GET /polymarket/line-moves",
      "POST /agent/dispatch",
    ],
  });
}

function handlePolymarketTicks(_req: Request): Response {
  const agent = new MarketDataAgent(regDb);
  return json({ ticks: agent.latestTicks(50) });
}

function handlePolymarketLineMoves(_req: Request): Response {
  const agent = new MarketDataAgent(regDb);
  return json({ lineMoves: agent.recentLineMoves(50) });
}

// ── Ops dashboard (/ops) ──

const OPS_CRON_FLOWS = [
  {
    label: "tennis-live-canary",
    logPath: "/tmp/bun.cron.kalshi-tennis-live-canary.stdout.log",
    launchdLabel: "bun.cron.kalshi-tennis-live-canary",
  },
  {
    label: "tennis-ws-recorder",
    logPath: "/tmp/bun.cron.kalshi-tennis-ws-recorder.stdout.log",
    launchdLabel: "bun.cron.kalshi-tennis-ws-recorder",
  },
] as const;

/** launchctl list, 2s timeout; null on any failure. */
async function probeLaunchdLabels(): Promise<Set<string> | null> {
  try {
    const proc = Bun.spawn(["launchctl", "list"], { stdout: "pipe", stderr: "ignore" });
    const text = (await Promise.race([
      new Response(proc.stdout).text(),
      Bun.sleep(2_000).then(() => null),
    ])) as string | null;
    if (text == null) {
      proc.kill();
      return null;
    }
    await proc.exited;
    return new Set(
      text
        .split("\n")
        .map((l) => l.trim().split(/\s+/).pop() ?? "")
        .filter((l) => l.startsWith("bun.cron.")),
    );
  } catch {
    return null;
  }
}

async function readCronFlow(
  spec: (typeof OPS_CRON_FLOWS)[number],
  launchd: Set<string> | null,
) {
  const file = Bun.file(spec.logPath);
  let lastFireAt: string | null = null;
  let lastLines: string[] = [];
  if (await file.exists()) {
    lastFireAt = new Date(file.lastModified).toISOString();
    const text = await file.text();
    lastLines = text.split("\n").filter((l) => l.trim().length > 0).slice(-3);
  }
  return {
    label: spec.label,
    logPath: spec.logPath,
    lastFireAt,
    lastLines,
    launchdLoaded: launchd == null ? null : launchd.has(spec.launchdLabel),
  };
}

async function readCanaryArtifact() {
  const file = Bun.file(joinPath(CACHE_DIR, "tennis-canary", "latest.json"));
  if (!(await file.exists())) return null;
  try {
    const raw = (await file.json()) as Record<string, unknown>;
    const s = (raw.summary ?? {}) as Record<string, number>;
    return {
      at: String(raw.at ?? ""),
      exitCode: Number(raw.exitCode ?? -1),
      dryRun: raw.dryRun === true,
      watched: Number(s.watched ?? 0),
      polled: Number(s.polled ?? 0),
      upserted: Number(s.upserted ?? 0),
      live: Number(s.live ?? 0),
      errors: Number(s.errors ?? 0),
    };
  } catch {
    return null;
  }
}

async function handleOpsPage(_req: Request): Promise<Response> {
  const roles = orchestrator.listRoles();
  const marketData = new MarketDataAgent(regDb);
  const launchd = await probeLaunchdLabels();
  const flows = await Promise.all(OPS_CRON_FLOWS.map((f) => readCronFlow(f, launchd)));

  return html(
    renderOps({
      generatedAt: new Date().toISOString(),
      agents: {
        orchestrator: true,
        market_data: roles.includes("market_data"),
        compliance: roles.includes("compliance"),
        ops: roles.includes("ops"),
        admin: roles.includes("admin"),
      },
      ticks: marketData.latestTicks(10),
      lineMoves: marketData.recentLineMoves(10),
      canary: await readCanaryArtifact(),
      flows,
      runs: listRunSummaries(5),
    }),
  );
}

async function handleAgentDispatch(req: Request): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const task = body.task as Parameters<typeof orchestrator.dispatch>[0];

  const result = await orchestrator.dispatch(task, {
    db: regDb,
    now: Date.now(),
    traceId: `req-${Date.now()}`,
  });

  return json(result);
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
    async fetch(req) {
      const url = new URL(req.url);

      // Ops dashboard (read-only management page)
      if (url.pathname === "/ops") {
        return handleOpsPage(req);
      }

      // Regulatory ops dashboard (no compliance gate, but rate-limited)
      if (url.pathname.startsWith("/ops/partners/")) {
        return rateLimiter(req, () => handlePartnerDetail(req));
      }

      // Bet placement — rate limit first, then compliance gate
      if (url.pathname === "/place-bet" && req.method === "POST") {
        return rateLimiter(req, () => stateValidator(req, () => complianceGate(req, () => handlePlaceBet(req))));
      }

      // Regulatory health check
      if (url.pathname === "/regulatory/health") {
        return json({
          service: "regulatory-compliance",
          states: ["MA", "NJ"],
          endpoints: ["POST /place-bet", "GET /ops/partners/:nodeId"],
        });
      }

      // ── Polymarket / agent routes ──

      if (url.pathname === "/polymarket/ingest" && req.method === "POST") {
        return rateLimiter(req, () => handlePolymarketIngest(req));
      }

      if (url.pathname === "/polymarket/status") {
        return handlePolymarketStatus(req);
      }

      if (url.pathname === "/polymarket/ticks") {
        return handlePolymarketTicks(req);
      }

      if (url.pathname === "/polymarket/line-moves") {
        return handlePolymarketLineMoves(req);
      }

      if (url.pathname === "/agent/dispatch" && req.method === "POST") {
        return rateLimiter(req, () => handleAgentDispatch(req));
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createResearchServer();
  console.log(`Research browser at ${server.url}`);
}
