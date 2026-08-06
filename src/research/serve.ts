// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import type { ResearchRun, ScoredRepo } from "./types.ts";
import {
  isFixtureRun,
  listRunSummaries,
  loadLatestProductionRunAnyDimension,
  loadRunFromDb,
} from "./cache.ts";
import { REPORT_DIR, CACHE_DIR, ROOT, joinPath } from "./paths.ts";
import { fullNameFromRouteParams, ROUTES, SERVE_PATTERNS } from "./patterns.ts";
import { pageLayout, renderIndex, renderOps, renderRepoPage, type KalshiAuthState } from "./views.ts";
import { renderArchitecture } from "./architecture-view.ts";
import { openEventStore } from "../institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../institutions/event-store/paths.ts";
import {
  buildLiquidityBoardPayload,
  getMatchLiquidity,
  listDeskLiquidityByEventId,
  listMatchLiquidityByTournament,
  recomputeMatchLiquidity,
  toLiquidityApiPayload,
  type DeskLiquidityFlags,
} from "../institutions/event-store/match-liquidity.ts";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { partnerDetailHandler } from "../regulatory/routes/ops/partners";
import { requireExecutionStateCompliance, requireStateCompliance, type ComplianceContext } from "../regulatory/middleware/state-compliance";
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
import {
  OPS_JSON_KIND,
  OPS_JSON_SCHEMA_VERSION,
  validateOpsDashboardJson,
  type OpsDashboardJson,
} from "./ops-json.ts";
import { buildHqPayload, resetTradingCache } from "./hq-data.ts";
import { renderHq } from "./hq-view.ts";
import hqApp from "./hq-app/index.html";
import { attachDeskLiquidityToBoard, fetchTennisBoard } from "./tennis-events.ts";
import { buildGlossaryApiPayload } from "../institutions/glossary.ts";
import { readPlayerProfiles } from "./player-profiles.ts";
import { buildTennisHqPayload, getPlayerDetail } from "./tennis-hq-data.ts";
import { readOpponentProfiles } from "./player-opponent-profiles.ts";
import {
  placeOrder,
  type KalshiClient,
} from "../bot/kalshi-client.ts";
import {
  createKalshiAccountClientResolver,
  executeKalshiLiveOrder,
  parseKalshiLiveOrderCommand,
} from "../partner/execution/kalshi-live.ts";
import { codedError, httpStatusFor, type ErrorCode } from "../institutions/error-codes.ts";
import { designAgent } from "../agent/design-agent.ts";
import { fetchKalshiBookSnapshot, midFromBookSnapshot } from "../bot/kalshi-market-data.ts";
import { buildSportsSourceCatalogPayload } from "./sports-source-catalog.ts";
import {
  requireTradingCancelPrincipal,
  requireTradingOrderPrincipal,
} from "./trading-auth.ts";
import {
  evaluateStoredExecutionRiskHealth,
  type ExecutionRiskHealthDecision,
} from "../partner/execution/risk-health.ts";
import { executeAuthorizedCancel } from "../partner/execution/cancel.ts";
import { migrateExecutionSchema } from "../partner/execution/sql.ts";

// ── Regulatory compliance integration ──
const REG_DB_PATH = process.env.REGULATORY_DB ?? ":memory:";
const regDb = new Database(REG_DB_PATH);

// Bootstrap schema if in-memory
if (REG_DB_PATH === ":memory:") {
  const migration011 = readFileSync(
    join(import.meta.dir, "../regulatory/db/migrations/011_state_regulation.sql"),
    "utf-8",
  );
  const migration012 = readFileSync(
    join(import.meta.dir, "../regulatory/db/migrations/012_polymarket.sql"),
    "utf-8",
  );
  const migration013 = readFileSync(
    join(import.meta.dir, "../regulatory/db/migrations/013_execution_play_lifecycle.sql"),
    "utf-8",
  );
  const migration014 = readFileSync(
    join(import.meta.dir, "../regulatory/db/migrations/014_execution_reservation_binding.sql"),
    "utf-8",
  );
  const seeds = readFileSync(
    join(import.meta.dir, "../regulatory/db/seeds/state_regulations.sql"),
    "utf-8",
  );
  regDb.exec(migration011);
  regDb.exec(migration012);
  regDb.exec(migration013);
  regDb.exec(migration014);
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
const executionComplianceGate = requireExecutionStateCompliance(regDb);
const rateLimiter = createRateLimiter({ windowMs: 60_000, max: 100 });
const stateValidator = createStateValidator({ allowed: ["MA", "NJ"] });
const resolveKalshiAccountClient = createKalshiAccountClientResolver();

export type ServeOptions = {
  port?: number;
  trading?: {
    db?: Database;
    /** Lifecycle seam: when db is absent, handler owns and closes this handle. */
    openExecutionDb?: () => Database;
    client?: Pick<KalshiClient, "environment" | "placeOrder" | "getBalance"> &
      Partial<Pick<KalshiClient, "cancelOrder">>;
    isRiskHealthy?: () => Promise<boolean | ExecutionRiskHealthDecision> | boolean | ExecutionRiskHealthDecision;
  };
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

const SPORTS_SOURCE_CATALOG_CACHE_MS = 5_000;
let sportsSourceCatalogCache:
  | { expiresAtMs: number; payload: ReturnType<typeof buildSportsSourceCatalogPayload> }
  | undefined;

export function resetSportsSourceCatalogCache(): void {
  sportsSourceCatalogCache = undefined;
}

function sportsSourceCatalogResponse(): Response {
  const nowMs = Date.now();
  const cached = sportsSourceCatalogCache;
  const cacheHit = cached !== undefined && nowMs < cached.expiresAtMs;
  const payload = cacheHit
    ? cached.payload
    : buildSportsSourceCatalogPayload({
        nowMs,
        onError: (error) => console.error("sports/source catalog read failed", error),
      });
  if (!cacheHit) {
    sportsSourceCatalogCache = { expiresAtMs: nowMs + SPORTS_SOURCE_CATALOG_CACHE_MS, payload };
  }
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "X-Sports-Source-Catalog-Cache": cacheHit ? "hit" : "miss",
    },
  });
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

export async function handleArchitecture(): Promise<Response> {
  return html(renderArchitecture());
}

// ── Regulatory route handlers ──
function handlePartnerDetail(req: Request, nodeId: string): Response {
  const url = new URL(req.url);
  const filters = {
    state: url.searchParams.get("state") ?? undefined,
    sport: url.searchParams.get("sport") ?? undefined,
    market: url.searchParams.get("market") ?? undefined,
  };
  let deskLiquidity: ReturnType<typeof buildLiquidityBoardPayload> | null = null;
  try {
    deskLiquidity = buildLiquidityBoardPayload(openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB }), {
      topLimit: 8,
      tournamentLimit: 8,
    });
  } catch {
    deskLiquidity = null;
  }
  return partnerDetailHandler(regDb, nodeId, filters, { deskLiquidity });
}

/** POST /place-bet payload (only the fields the handler reads). */
type PlaceBetBody = {
  wagerAmount?: number;
  userId?: string;
};

async function handlePlaceBet(req: Request): Promise<Response> {
  const body = (await req.json()) as PlaceBetBody;
  // Attached by the compliance gate upstream in the middleware chain.
  const ctx = (req as Request & { compliance?: ComplianceContext }).compliance;
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

function finalizeRegulatoryExecution(
  req: Request,
  status: "confirmed" | "rejected" | "unknown",
  reservationId?: number,
  reason?: string | null,
): void {
  const key = (req as Request & { compliance?: ComplianceContext }).compliance
    ?.executionIdempotencyKey;
  if (!key) return;
  complianceRepo.transitionExecutionPlay({
    idempotencyKey: key,
    status,
    reservationId: reservationId ?? null,
    reason: reason ?? null,
  });
}

export async function handleTradingOrder(
  req: Request,
  runtime: ServeOptions["trading"] = {},
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badOrder("E_BODY_INVALID");
  }

  const dryRun = body.dryRun !== false;
  if (!dryRun) {
    if (!(req as Request & { compliance?: ComplianceContext }).compliance) {
      return badOrder("E_AUTH_CONTEXT_REQUIRED", "live order did not pass compliance middleware");
    }
    const parsed = parseKalshiLiveOrderCommand(body, req.headers.get("Idempotency-Key"));
    if (!parsed.ok) {
      return badOrder(
        parsed.code === "IDEMPOTENCY_REQUIRED"
          ? "E_IDEMPOTENCY_REQUIRED"
          : "E_AUTH_CONTEXT_REQUIRED",
        parsed.reason,
      );
    }
    const ownsDb = runtime.db === undefined;
    const executionDb = runtime.db ??
      (runtime.openExecutionDb ?? (() => openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB })))();
    let result: Awaited<ReturnType<typeof executeKalshiLiveOrder>>;
    try {
      migrateExecutionSchema(executionDb);
      result = await executeKalshiLiveOrder(executionDb, {
        ...parsed.command,
        actorId: req.tradingPrincipal?.actorId,
      }, {
        ...(runtime.client
          ? { client: runtime.client }
          : { resolveClient: resolveKalshiAccountClient }),
        isRiskHealthy:
          runtime.isRiskHealthy ??
          (() => evaluateStoredExecutionRiskHealth({
            db: executionDb,
            outId: parsed.command.outId,
            ticker: parsed.command.ticker,
            outEnvPrefix: `KALSHI_${parsed.command.partnerCode}_${parsed.command.outId.split("-").at(-1)}_`,
          })),
      });
    } finally {
      if (ownsDb) executionDb.close();
    }
    if (!result.ok) {
      if (result.code === "PROVIDER_NOT_IMPLEMENTED") {
        finalizeRegulatoryExecution(req, "rejected", undefined, result.reason);
        return badOrder("E_PROVIDER_NOT_IMPLEMENTED", result.reason);
      }
      if (result.code === "PROVIDER_SESSION_UNAVAILABLE") {
        finalizeRegulatoryExecution(req, "rejected", undefined, result.reason);
        return badOrder(
          /missing kalshi_(?:api_key_id|access_key|private_key)/i.test(result.reason)
            ? "E_NO_CREDS"
            : "E_UPSTREAM",
          result.reason,
        );
      }
      if (
        result.code === "ACCOUNT_NOT_FOUND" ||
        result.code === "ACCOUNT_INACTIVE" ||
        result.code === "PARTNER_INACTIVE" ||
        result.code === "PARTNER_MISMATCH" ||
        result.code === "SKIN_INACTIVE" ||
        result.code === "CURRENCY_UNSUPPORTED"
      ) {
        finalizeRegulatoryExecution(req, "rejected", undefined, result.reason);
        return badOrder("E_ACCOUNT_INACTIVE", result.reason);
      }
      if (result.execution?.code === "PROVIDER_OUTCOME_UNKNOWN") {
        finalizeRegulatoryExecution(req, "unknown", result.execution.reservationId, result.reason);
        return badOrder("E_EXECUTION_UNKNOWN", result.reason);
      }
      if (result.execution?.code === "PROVIDER_REJECTED") {
        finalizeRegulatoryExecution(req, "rejected", result.execution.reservationId, result.reason);
        return badOrder("E_EXECUTION_REJECTED", result.reason);
      }
      if (result.execution?.code === "SNAPSHOT_UNAVAILABLE") {
        finalizeRegulatoryExecution(req, "rejected", result.execution.reservationId, result.reason);
        return badOrder("E_UPSTREAM", result.reason);
      }
      finalizeRegulatoryExecution(req, "rejected", result.execution?.reservationId, result.reason);
      return badOrder("E_AUTHORIZATION_REQUIRED", result.reason);
    }
    resetTradingCache();
    finalizeRegulatoryExecution(req, "confirmed", result.result.reservationId);
    return json({
      ok: true,
      dryRun: false,
      orderId: result.result.ticketId,
      reservationId: result.result.reservationId,
      effectiveStakeMinorUnits: result.result.effectiveStake,
      status: result.order?.state ?? "confirmed",
      fillCount: result.order?.fillCount ?? null,
      remainingCount: result.order?.remainingCount ?? null,
      ticker: parsed.command.ticker,
      outcome: parsed.command.outcome,
      partnerCode: parsed.command.partnerCode,
      outId: parsed.command.outId,
      skin: parsed.command.skin,
    });
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

export async function handleTradingCancel(
  req: Request,
  runtime: ServeOptions["trading"] = {},
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return badOrder("E_BODY_INVALID");
  }
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return badOrder("E_ORDER_ID_REQUIRED");
  const principal = req.tradingPrincipal;
  if (!principal) {
    return json({ ok: false, code: "E_OPERATOR_AUTH_REQUIRED", error: "operator authentication is required" }, 401);
  }
  const headerKey = req.headers.get("Idempotency-Key")?.trim() || "";
  const bodyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!headerKey && !bodyKey) return badOrder("E_IDEMPOTENCY_REQUIRED");
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    return badOrder("E_BODY_INVALID", "body and Idempotency-Key header must match");
  }
  const idempotencyKey = headerKey || bodyKey;
  const ownsDb = runtime.db === undefined;
  const db = runtime.db ??
    (runtime.openExecutionDb ?? (() => openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB })))();
  try {
    migrateExecutionSchema(db);
    const result = await executeAuthorizedCancel(db, {
      ticketId: orderId,
      idempotencyKey,
      principal,
    }, {
      resolveClient: runtime.client?.cancelOrder
        ? () => runtime.client as Pick<KalshiClient, "environment" | "cancelOrder">
        : resolveKalshiAccountClient,
      isRiskHealthy:
        runtime.isRiskHealthy ??
        ((reservation) => evaluateStoredExecutionRiskHealth({
          db,
          outId: reservation.outId,
          ticker: reservation.marketId,
          outEnvPrefix: `KALSHI_${reservation.partnerCode}_${reservation.outId.split("-").at(-1)}_`,
        })),
    });
    if (!result.ok) {
      const status = result.code === "CANCEL_OUTCOME_UNKNOWN" ? 202
        : result.code === "CANCEL_REJECTED" ? 409
        : result.code === "RESERVATION_NOT_FOUND" ? 404
        : result.code === "INVALID_REQUEST" ? 400
        : 403;
      return json({ ok: false, code: result.code, error: result.reason }, status);
    }
    resetTradingCache();
    return json({ ok: true, cancelled: orderId, reservationId: result.reservationId, code: result.code });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return badOrder("E_UPSTREAM", msg.slice(0, 200));
  } finally {
    if (ownsDb) db.close();
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
  state: KalshiAuthState;
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

  const payload: OpsDashboardJson = {
    kind: OPS_JSON_KIND,
    schemaVersion: OPS_JSON_SCHEMA_VERSION,
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
  };

  // Self-check: log schema drift but never break the endpoint on its own validator.
  const validation = validateOpsDashboardJson(payload);
  if (!validation.ok) {
    console.error(`[ops.json] schema self-check failed: ${validation.errors.join("; ")}`);
  }
  return json(payload);
}

/** POST /agent/dispatch payload — the orchestrator task envelope. */
type AgentDispatchBody = {
  task?: Parameters<typeof orchestrator.dispatch>[0];
};

async function handleAgentDispatch(req: Request): Promise<Response> {
  const body = (await req.json()) as AgentDispatchBody;
  if (!body.task) {
    return json({ ok: false, error: "task is required: { task: { type, payload } }" }, 400);
  }

  const result = await orchestrator.dispatch(body.task, {
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
/** POST /ops/kalshi-rotate-key payload (fields validated by typeof below). */
type KalshiRotateBody = {
  keyId?: unknown;
  pem?: unknown;
  dryRun?: unknown;
  confirm?: unknown;
};

async function handleKalshiRotateKey(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as KalshiRotateBody;
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


async function handleKpi(): Promise<Record<string, number>> {
  try {
    const store = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
    /** Soft SQL — missing tables/columns (watch_set, rps_flag, …) return 0. */
    const snapshot = (sql: string): number => {
      try {
        return (store.query(sql).get() as Record<string, number> | null)?.n ?? 0;
      } catch {
        return 0;
      }
    };
    let board: ReturnType<typeof buildLiquidityBoardPayload> | null = null;
    try {
      board = buildLiquidityBoardPayload(store, { topLimit: 1, tournamentLimit: 1 });
    } catch {
      board = null;
    }
    const s = board?.summary;
    return {
      open_matches: snapshot("SELECT COUNT(*) AS n FROM events WHERE corpus='trading'"),
      board_volume: board?.boardVolume ||
        snapshot("SELECT COALESCE(SUM(CAST(volume_fp AS REAL)),0) AS n FROM markets WHERE volume_fp IS NOT NULL"),
      book_watches: snapshot("SELECT COUNT(*) AS n FROM watch_set WHERE active=1"),
      player_profiles: snapshot("SELECT COUNT(*) AS n FROM player_profiles"),
      rps_warnings: snapshot("SELECT COUNT(*) AS n FROM events WHERE rps_flag=1"),
      graph_divergence: snapshot("SELECT COUNT(*) AS n FROM events WHERE graph_divergence=1"),
      price_archive: snapshot("SELECT COUNT(*) AS n FROM price_snapshots"),
      server_errors: snapshot("SELECT total_errors AS n FROM logger_health WHERE id=1"),
      // match_liquidity → glossary kpi.* chips
      tight_markets: s?.liquidityOk ?? 0,
      tradable_matches: s?.tradable ?? 0,
      quoted_books: s?.quoted ?? 0,
      median_spread: board?.medianSpreadCents ?? 0,
      store_link_rate: 0,
      live_scores: 0,
      elite_conviction: 0,
      archive_elo_fair: 0,
      top_edge: 0,
      scanner_alerts: 0,
    };
  } catch {
    return {};
  }
}

function handleLiquidityBoard(url: URL): Response {
  try {
    const store = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
    if (url.searchParams.get("recompute") === "1") {
      recomputeMatchLiquidity(store);
    }
    const topLimit = Number(url.searchParams.get("limit") ?? "24");
    return json(
      buildLiquidityBoardPayload(store, {
        topLimit: Number.isFinite(topLimit) ? topLimit : 24,
      }),
    );
  } catch (err) {
    return json(
      {
        error: "liquidity_store_unavailable",
        detail: err instanceof Error ? err.message : String(err),
      },
      503,
    );
  }
}

/**
 * GET /api/events — Kalshi open board + deskLiquidity join.
 * Optional server filters: liquidity, minVolume/minVol (HQ still filters client-side too).
 */
async function handleEventsBoard(url: URL): Promise<unknown> {
  const board = await fetchTennisBoard();
  let deskIndex = new Map<string, DeskLiquidityFlags>();
  try {
    const store = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
    deskIndex = listDeskLiquidityByEventId(store);
  } catch {
    // Event-store optional — board still serves without desk flags.
  }
  const liquidity =
    url.searchParams.get("liquidity") ??
    (url.searchParams.get("tradable") === "1" ? "tradable" : "all");
  const minRaw = url.searchParams.get("minVolume") ?? url.searchParams.get("minVol");
  const minVolume = minRaw != null && minRaw !== "" ? Number(minRaw) : 0;
  return attachDeskLiquidityToBoard(board, deskIndex, {
    liquidity,
    minVolume: Number.isFinite(minVolume) ? minVolume : 0,
    // Keep empty series so HQ series panels still render "unavailable" / empty.
    dropEmptySeries: false,
  });
}

function openLiquidityStore(): Database {
  return openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
}

/** GET /api/liquidity/:eventId — optional ?recompute=1 to refresh from markets/books. */
function handleLiquidityByEvent(eventIdRaw: string, url: URL): Response {
  const eventId = decodeURIComponent(eventIdRaw).trim();
  if (!eventId) {
    return json({ error: "eventId required" }, 400);
  }
  try {
    const store = openLiquidityStore();
    if (url.searchParams.get("recompute") === "1") {
      recomputeMatchLiquidity(store, eventId);
    }
    const row = getMatchLiquidity(store, eventId);
    if (!row) {
      // Lazy recompute once if table empty for this event but event exists
      const exists = store
        .query(`SELECT 1 AS ok FROM events WHERE event_id = $id`)
        .get({ $id: eventId }) as { ok: number } | null;
      if (exists) {
        recomputeMatchLiquidity(store, eventId);
        const again = getMatchLiquidity(store, eventId);
        if (again) return json(toLiquidityApiPayload(again));
      }
      return json({ error: "not_found", eventId }, 404);
    }
    return json(toLiquidityApiPayload(row));
  } catch (err) {
    return json(
      { error: "liquidity_store_unavailable", detail: err instanceof Error ? err.message : String(err) },
      503,
    );
  }
}

/** GET /api/liquidity/by-tournament/:key — optional ?sport=tennis&limit=50&recompute=1 */
function handleLiquidityByTournament(keyRaw: string, url: URL): Response {
  const key = decodeURIComponent(keyRaw).trim();
  if (!key) {
    return json({ error: "tournament key required" }, 400);
  }
  try {
    const store = openLiquidityStore();
    if (url.searchParams.get("recompute") === "1") {
      recomputeMatchLiquidity(store);
    }
    const sportKey = url.searchParams.get("sport")?.trim() || undefined;
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    const rows = listMatchLiquidityByTournament(store, key, { sportKey, limit });
    return json({
      tournament: key,
      sportKey: sportKey ?? null,
      count: rows.length,
      matches: rows.map(toLiquidityApiPayload),
    });
  } catch (err) {
    return json(
      { error: "liquidity_store_unavailable", detail: err instanceof Error ? err.message : String(err) },
      503,
    );
  }
}

export function createResearchServer(options: ServeOptions = {}) {
  const port = options.port ?? Number(Bun.env.PORT ?? 3456);
  const serveOptions = {
    port,
    routes: {
      "/hq": hqApp,
      [ROUTES.home]: handleHome,
      [ROUTES.runsList]: handleRunsList,
      [ROUTES.runApi]: handleRunApi,
      [ROUTES.repo]: handleRepoPage,
      [ROUTES.latestReport]: handleLatestReport,
      [ROUTES.architecture]: handleArchitecture,
    },
    async fetch(req: Request) {
      const url = new URL(req.url);

      // ── URLPattern routes (parameterized) — SERVE_PATTERNS in patterns.ts ──
      // @see https://bun.com/blog/bun-v1.3.4#urlpattern-api
      {
        const g = SERVE_PATTERNS.opsPartner.groups(url);
        if (g?.nodeId) {
          return rateLimiter(req, () => handlePartnerDetail(req, g.nodeId!));
        }
      }
      {
        const g = SERVE_PATTERNS.tennisPlayer.groups(url);
        if (g?.name) {
          const name = decodeURIComponent(g.name);
          const result = getPlayerDetail(name);
          return json(result, result.state === "not_found" ? 404 : 200);
        }
      }
      if (url.pathname === "/api/hq/tennis/player") {
        const name = url.searchParams.get("name")?.trim() ?? "";
        if (!name) {
          return json({ state: "not_found", playerName: "", error: "name query param required" }, 400);
        }
        const result = getPlayerDetail(name);
        return json(result, result.state === "not_found" ? 404 : 200);
      }

      // Match liquidity board (exact paths before :eventId)
      if (
        url.pathname === SERVE_PATTERNS.EXACT.liquidityBoard ||
        url.pathname === SERVE_PATTERNS.EXACT.liquiditySummary
      ) {
        return handleLiquidityBoard(url);
      }
      // Derived from markets + book_ticks — no rateLimiter
      {
        const g = SERVE_PATTERNS.liquidityByEvent.groups(url);
        if (g?.eventId && g.eventId !== "summary" && g.eventId !== "by-tournament") {
          return handleLiquidityByEvent(g.eventId!, url);
        }
      }
      {
        const g = SERVE_PATTERNS.liquidityByTournament.groups(url);
        if (g?.key) {
          return handleLiquidityByTournament(g.key!, url);
        }
      }

      // HQ headquarters dashboard served via routes["/hq"] = hqApp (HTML import)

      // HQ aggregate data feed (JSON)
      if (url.pathname === "/api/hq/tennis") {
        return json(await buildTennisHqPayload());
      }

      if (url.pathname === "/api/registry/sports-sources") {
        return sportsSourceCatalogResponse();
      }

      // Glossary — structured entries + flat tooltips for HQ panel/tips
      if (url.pathname === "/api/glossary") {
        return json(buildGlossaryApiPayload());
      }

      if (url.pathname === "/api/kpi") {
        return json(await handleKpi());
      }

      if (url.pathname === "/colors.css") {
        const file = Bun.file(joinPath(ROOT, "public/colors.css"));
        if (!(await file.exists())) {
          return new Response("colors.css missing — run bun run colors:artifacts", { status: 404 });
        }
        return new Response(file, {
          headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-cache" },
        });
      }

      if (url.pathname === "/registry/color-system.json") {
        const file = Bun.file(joinPath(ROOT, "public/registry/color-system.json"));
        if (!(await file.exists())) {
          return new Response("color-system.json missing — run bun run colors:artifacts", { status: 404 });
        }
        return new Response(file, {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" },
        });
      }

      if (url.pathname === "/registry/sports-sources.json") {
        const file = Bun.file(joinPath(ROOT, "public/registry/sports-sources.json"));
        if (!(await file.exists())) {
          return new Response("sports-sources.json missing — run bun run sports:registry:bake", {
            status: 404,
          });
        }
        return new Response(file, {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" },
        });
      }

      // Partner ops static board (bake: bun run partner:dashboard)
      // Paths: /partner-dashboard[/] → index.html · /partner-dashboard/state.json
      if (
        url.pathname === SERVE_PATTERNS.EXACT.partnerDashboard ||
        url.pathname === SERVE_PATTERNS.EXACT.partnerDashboardSlash ||
        url.pathname === SERVE_PATTERNS.EXACT.partnerDashboardState
      ) {
        const name =
          url.pathname === SERVE_PATTERNS.EXACT.partnerDashboardState
            ? "state.json"
            : "index.html";
        const file = Bun.file(
          joinPath(ROOT, "public/partner-dashboard", name),
        );
        if (!(await file.exists())) {
          return new Response(
            "partner-dashboard missing — run: bun run partner:dashboard",
            { status: 404 },
          );
        }
        const contentType =
          name === "state.json"
            ? "application/json; charset=utf-8"
            : "text/html; charset=utf-8";
        return new Response(file, {
          headers: {
            "content-type": contentType,
            "cache-control": "no-cache",
          },
        });
      }

      if (url.pathname === "/api/hq") {
        return json(await buildHqPayload());
      }

      // Tennis event board — all open match events w/ nested markets (60s cache)
      // + desk match_liquidity flags for HQ filters/badges.
      // Query: ?liquidity=all|priced|active|quoted|liq_ok|tradable&minVolume=N
      if (url.pathname === "/api/events") {
        return json(await handleEventsBoard(url));
      }

      // Player profiles derived from the event store
      if (url.pathname === "/api/profiles") {
        const sortParam = url.searchParams.get("sort");
        const sort = sortParam === "appearances" ? "appearances" : "volume";
        return json(
          readPlayerProfiles({
            limit: Number(url.searchParams.get("limit") ?? 50),
            search: url.searchParams.get("search") ?? undefined,
            sort,
          }),
        );
      }

      // Player↔opponent head-to-head (volume per matchup) from the event store
      if (url.pathname === "/api/opponent-profiles") {
        return json(
          readOpponentProfiles({
            limit: Number(url.searchParams.get("limit") ?? 50),
            player: url.searchParams.get("player") ?? undefined,
            opponent: url.searchParams.get("opponent") ?? undefined,
          }),
        );
      }

      // Ops dashboard (read-only management page)
      if (url.pathname === "/ops") {
        return handleOpsPage(req);
      }

      // Ops dashboard JSON companion
      if (url.pathname === "/ops.json") {
        return handleOpsJson(req);
      }

      // /ops/partners/:nodeId — SERVE_PATTERNS.opsPartner (above)

      // Bet placement — rate limit first, then compliance gate
      if (url.pathname === "/place-bet" && req.method === "POST") {
        return rateLimiter(req, () => stateValidator(req, () => complianceGate(req, () => handlePlaceBet(req))));
      }

      // HQ order entry — same middleware stack as /place-bet; dry-run unless explicit dryRun:false
      if (url.pathname === "/api/trading/order" && req.method === "POST") {
        return rateLimiter(req, () => requireTradingOrderPrincipal(req, () => stateValidator(req, () => executionComplianceGate(req, () => handleTradingOrder(req, options.trading)))));
      }

      // HQ order cancel
      if (url.pathname === "/api/trading/cancel" && req.method === "POST") {
        return rateLimiter(req, () => requireTradingCancelPrincipal(req, () => handleTradingCancel(req, options.trading)));
      }

      // HQ orderbook preview (public market data)
      if (url.pathname === "/api/trading/book") {
        return rateLimiter(req, () => handleTradingBook(req));
      }

      // Design system manifest (tokens, components, brand)
      if (url.pathname === "/api/design") {
        return json(designAgent.manifest());
      }

      // Design agent audit of the live HQ page (self-check)
      if (url.pathname === "/api/design/audit") {
        return json(designAgent.audit(renderHq()));
      }

      // Regulatory health check (+ live Kalshi exchange probe)
      if (url.pathname === "/regulatory/health") {
        const { probeKalshiExchange } = await import("../institutions/url-health.ts");
        const exchange = await probeKalshiExchange("prod");
        return json({
          service: "regulatory-compliance",
          states: ["MA", "NJ"],
          endpoints: [
            "POST /place-bet",
            "GET /ops/partners/:nodeId",
            "GET /api/health/urls",
            "GET /api/health/kalshi",
          ],
          kalshiExchange: {
            ok: exchange.ok,
            status: exchange.status,
            latencyMs: exchange.latencyMs,
            probeUrl: exchange.probeUrl,
          },
        }, exchange.ok ? 200 : 503);
      }

      // Full OFFICIAL_URLS (+ optional glossary) liveness report
      if (url.pathname === "/api/health/urls") {
        const { probeOfficialCatalog } = await import("../institutions/url-health.ts");
        const includeGlossary = url.searchParams.get("glossary") === "1";
        const report = await probeOfficialCatalog({ includeGlossary });
        return json(report, report.ok ? 200 : 503);
      }

      // Kalshi exchange status — ?env=prod|demo|elections
      if (url.pathname === "/api/health/kalshi") {
        const { probeKalshiExchange } = await import("../institutions/url-health.ts");
        const env = url.searchParams.get("env");
        const which =
          env === "demo" || env === "elections" ? env : "prod";
        const row = await probeKalshiExchange(which);
        return json(row, row.ok ? 200 : 503);
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
  };
  // bun-types 1.3.x lag: inside `declare module "bun"`, the `Request` used by
  // Bun.serve's route/fetch signatures is the headers-only Bun.Request — it
  // lacks url/method even though the runtime passes a full DOM Request. Cast
  // the config once here instead of sprinkling casts through every handler.
  return Bun.serve(serveOptions as Bun.Serve.Options<undefined, string>);
}

if (import.meta.main) {
  const server = createResearchServer();
  console.log(`Research browser at ${server.url}`);
}
