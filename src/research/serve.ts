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
import { openEventStore } from "../institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../institutions/event-store/paths.ts";
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
import { TABLE } from "../regulatory/constants";
import { loadKalshiCredentials, probeKalshiAuth } from "../bot/kalshi-auth.ts";
import { rotateKalshiKey } from "../bot/kalshi-rotate.ts";
import { buildHqPayload, resetTradingCache } from "./hq-data.ts";
import { renderHq } from "./hq-view.ts";
import { placeOrder, cancelOrder } from "../bot/kalshi-client.ts";
import { codedError, httpStatusFor, type ErrorCode } from "../institutions/error-codes.ts";
import { fetchKalshiBookSnapshot, midFromBookSnapshot } from "../bot/kalshi-market-data.ts";

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

// ── HQ order entry (dry-run by default; live only on explicit dryRun:false) ──

function badOrder(code: ErrorCode, upstream?: string): Response {
  return json(codedError(code, upstream), httpStatusFor(code));
}

async function handleTradingOrder(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badOrder("E_BODY_INVALID");
  }

  const ticker = typeof body.ticker === "string" ? body.ticker.trim() : "";
  if (!ticker) return badOrder("E_TICKER_REQUIRED");
  const side = body.side === "no" ? "no" : body.side === "yes" ? "yes" : null;
  if (!side) return badOrder("E_SIDE_INVALID");
  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > 10_000) {
    return badOrder("E_COUNT_RANGE");
  }
  const priceCents = Number(body.priceCents);
  if (!Number.isInteger(priceCents) || priceCents < 1 || priceCents > 99) {
    return badOrder("E_PRICE_RANGE");
  }
  // Safety rail: anything other than explicit `false` stays dry-run.
  const dryRun = body.dryRun !== false;

  try {
    const result = await placeOrder({
      ticker,
      side,
      count,
      priceCents,
      dryRun,
      postOnly: body.postOnly !== false,
    });
    resetTradingCache();
    return json({ ok: true, dryRun, orderId: result.orderId, ticker, side, count, priceCents });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return badOrder("E_UPSTREAM", msg.slice(0, 200));
  }
}

async function handleTradingCancel(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badOrder("E_BODY_INVALID");
  }
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return badOrder("E_ORDER_ID_REQUIRED");
  try {
    await cancelOrder(orderId);
    resetTradingCache();
    return json({ ok: true, cancelled: orderId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return badOrder("E_UPSTREAM", msg.slice(0, 200));
  }
}

// ── HQ orderbook preview (public market data, short per-ticker cache) ──

const BOOK_CACHE_TTL_MS = 5_000;
const bookCache = new Map<string, { value: unknown; expiresAtMs: number }>();

async function handleTradingBook(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "").trim();
  if (!ticker) return badOrder("E_TICKER_REQUIRED");
  const depth = Math.min(Math.max(Number(url.searchParams.get("depth")) || 10, 1), 100);
  const key = `${ticker}:${depth}`;
  const nowMs = Date.now();
  const hit = bookCache.get(key);
  if (hit && nowMs < hit.expiresAtMs) return json(hit.value);
  try {
    const book = await fetchKalshiBookSnapshot(ticker as never, { depth });
    const bestBid = book.bids[0]?.priceCents ?? null;
    const bestAsk = book.asks[0]?.priceCents ?? null;
    const value = {
      ok: true,
      ticker,
      mid: midFromBookSnapshot(book),
      spreadCents: bestBid != null && bestAsk != null ? bestAsk - bestBid : null,
      crossed: book.crossed === true,
      bids: book.bids.slice(0, 10),
      asks: book.asks.slice(0, 10),
      checkedAt: new Date(nowMs).toISOString(),
    };
    bookCache.set(key, { value, expiresAtMs: nowMs + BOOK_CACHE_TTL_MS });
    return json(value);
  } catch (err) {
    return json(
      { ok: false, ticker, error: err instanceof Error ? err.message : String(err) },
      502,
    );
  }
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

/** Process boot time for the Server panel (module load ≈ server start). */
const OPS_BOOT_AT = new Date();

// ── Kalshi auth badge (cached probe) ──

export type OpsKalshiAuth = {
  state: "valid" | "invalid" | "unreachable" | "no-creds";
  status?: number;
  checkedAt: string;
  cacheTtlSec: number;
};

const KALSHI_AUTH_CACHE_TTL_SEC = 300;
let kalshiAuthCache: { value: OpsKalshiAuth; expiresAtMs: number } | null = null;

/** Test hook — drop the cached probe so each case re-fetches. */
export function resetKalshiAuthCache(): void {
  kalshiAuthCache = null;
}

/**
 * Kalshi credential probe with a 5-minute module-scope cache. The /ops page
 * meta-refreshes every 60s — probing on every render would hammer the Kalshi
 * API (and looks like credential brute-forcing), so a render within the TTL
 * reuses the last result.
 */
export async function probeKalshiAuthCached(
  opts: { base?: string; timeoutMs?: number; nowMs?: number } = {},
): Promise<OpsKalshiAuth> {
  const nowMs = opts.nowMs ?? Date.now();
  if (kalshiAuthCache && nowMs < kalshiAuthCache.expiresAtMs) {
    return kalshiAuthCache.value;
  }
  const checkedAt = new Date(nowMs).toISOString();
  let value: OpsKalshiAuth;
  let creds: ReturnType<typeof loadKalshiCredentials> | null = null;
  try {
    creds = loadKalshiCredentials();
  } catch {
    value = { state: "no-creds", checkedAt, cacheTtlSec: KALSHI_AUTH_CACHE_TTL_SEC };
  }
  if (creds) {
    try {
      const probe = await probeKalshiAuth(creds, {
        base: opts.base,
        timeoutMs: opts.timeoutMs ?? 2_000,
      });
      const state =
        probe.status === 200
          ? "valid"
          : probe.status === 401 || probe.status === 403
            ? "invalid"
            : "unreachable";
      value = { state, status: probe.status, checkedAt, cacheTtlSec: KALSHI_AUTH_CACHE_TTL_SEC };
    } catch {
      value = { state: "unreachable", checkedAt, cacheTtlSec: KALSHI_AUTH_CACHE_TTL_SEC };
    }
  }
  kalshiAuthCache = { value: value!, expiresAtMs: nowMs + KALSHI_AUTH_CACHE_TTL_SEC * 1000 };
  return value!;
}

/** Process self-metrics + in-memory regDb signal counts. */
function readOpsServerStats() {
  const mem = process.memoryUsage();
  const count = (table: string): number => {
    try {
      const row = regDb.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | null;
      return row?.n ?? 0;
    } catch {
      return 0; // table absent before migrations/ingest
    }
  };
  return {
    bootAt: OPS_BOOT_AT.toISOString(),
    uptimeSec: Math.round(process.uptime()),
    bunVersion: Bun.version,
    rssMb: mem.rss / 1_048_576,
    heapUsedMb: mem.heapUsed / 1_048_576,
    tickCount: count(TABLE.POLYMARKET_TICKS),
    lineMoveCount: count(TABLE.POLYMARKET_LINE_MOVES),
  };
}

const OPS_CRON_FLOWS = [
  {
    label: "tennis-live-canary",
    logPath: "/tmp/bun.cron.kalshi-tennis-live-canary.stdout.log",
    launchdLabel: "bun.cron.kalshi-tennis-live-canary",
    periodMin: 15,
  },
  {
    label: "tennis-ws-recorder",
    logPath: "/tmp/bun.cron.kalshi-tennis-ws-recorder.stdout.log",
    launchdLabel: "bun.cron.kalshi-tennis-ws-recorder",
    periodMin: 30,
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
    periodMin: spec.periodMin,
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

const EVENT_STORE_TABLES = [
  "events",
  "markets",
  "resolutions",
  "book_ticks",
  "score_snapshots",
  "odds_ticks",
] as const;

/** Read-only row counts from the tennis event store; null when the DB is absent/unreadable. */
async function readEventStoreCounts() {
  try {
    if (!(await Bun.file(DEFAULT_EVENT_STORE_DB).exists())) return null;
    const db = openEventStore({ readonly: true });
    try {
      const counts: Record<string, number> = {};
      for (const table of EVENT_STORE_TABLES) {
        try {
          const row = db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number } | null;
          counts[table] = row?.n ?? 0;
        } catch {
          counts[table] = -1; // table missing in older DBs
        }
      }
      return { dbPath: DEFAULT_EVENT_STORE_DB, counts };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

async function handleOpsPage(_req: Request): Promise<Response> {
  const roles = orchestrator.listRoles();
  const marketData = new MarketDataAgent(regDb);
  const launchd = await probeLaunchdLabels();
  const flows = await Promise.all(OPS_CRON_FLOWS.map((f) => readCronFlow(f, launchd)));
  const canary = await readCanaryArtifact();

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
      canary: canary && { ...canary, periodMin: OPS_CRON_FLOWS[0].periodMin },
      store: await readEventStoreCounts(),
      kalshiAuth: await probeKalshiAuthCached(),
      server: readOpsServerStats(),
      flows,
      runs: listRunSummaries(5),
    }),
  );
}

/** Machine-readable companion to /ops (same data, JSON). */
async function handleOpsJson(_req: Request): Promise<Response> {
  const roles = orchestrator.listRoles();
  const marketData = new MarketDataAgent(regDb);
  const launchd = await probeLaunchdLabels();
  const flows = await Promise.all(OPS_CRON_FLOWS.map((f) => readCronFlow(f, launchd)));
  const canary = await readCanaryArtifact();

  return json({
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
    canary: canary && { ...canary, periodMin: OPS_CRON_FLOWS[0].periodMin },
    store: await readEventStoreCounts(),
    kalshiAuth: await probeKalshiAuthCached(),
    server: readOpsServerStats(),
    flows,
    runs: listRunSummaries(5),
  });
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

/**
 * POST /ops/kalshi-rotate-key — install a new Kalshi API key from the dashboard.
 * confirm:true is required for a real apply; dryRun:true previews (planned
 * writes + probe) without confirmation. Response never echoes pem and masks
 * keyId to its first 8 chars.
 */
async function handleKalshiRotateKey(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const keyId = typeof body.keyId === "string" ? body.keyId.trim() : "";
  const pem = typeof body.pem === "string" ? body.pem : "";
  const dryRun = body.dryRun === true;
  const confirm = body.confirm === true;

  if (!keyId || !pem) {
    return json({ ok: false, error: "keyId and pem are required" }, 400);
  }
  if (!dryRun && !confirm) {
    return json(
      { ok: false, error: "confirm:true is required to apply rotation (dryRun:true previews without it)" },
      400,
    );
  }

  const result = await rotateKalshiKey({ keyId, pemText: pem, dryRun });
  if (!dryRun) {
    // Badge reflects the new key on the very next /ops render.
    resetKalshiAuthCache();
  }
  return json({ ...result, keyId: `${keyId.slice(0, 8)}…` });
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

      // HQ headquarters dashboard (research + alpha + trading)
      if (url.pathname === "/hq") {
        return html(renderHq());
      }

      // HQ aggregate data feed (JSON)
      if (url.pathname === "/api/hq") {
        return json(await buildHqPayload());
      }

      // Ops dashboard (read-only management page)
      if (url.pathname === "/ops") {
        return handleOpsPage(req);
      }

      // Ops dashboard JSON companion
      if (url.pathname === "/ops.json") {
        return handleOpsJson(req);
      }

      // Regulatory ops dashboard (no compliance gate, but rate-limited)
      if (url.pathname.startsWith("/ops/partners/")) {
        return rateLimiter(req, () => handlePartnerDetail(req));
      }

      // Bet placement — rate limit first, then compliance gate
      if (url.pathname === "/place-bet" && req.method === "POST") {
        return rateLimiter(req, () => stateValidator(req, () => complianceGate(req, () => handlePlaceBet(req))));
      }

      // HQ order entry — same middleware stack as /place-bet; dry-run unless explicit dryRun:false
      if (url.pathname === "/api/trading/order" && req.method === "POST") {
        return rateLimiter(req, () => stateValidator(req, () => complianceGate(req, () => handleTradingOrder(req))));
      }

      // HQ order cancel
      if (url.pathname === "/api/trading/cancel" && req.method === "POST") {
        return rateLimiter(req, () => handleTradingCancel(req));
      }

      // HQ orderbook preview (public market data)
      if (url.pathname === "/api/trading/book") {
        return rateLimiter(req, () => handleTradingBook(req));
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

      if (url.pathname === "/ops/kalshi-rotate-key" && req.method === "POST") {
        return rateLimiter(req, () => handleKalshiRotateKey(req));
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createResearchServer();
  console.log(`Research browser at ${server.url}`);
}
