// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
import { $ } from "bun";
import { createLiveChannel, registerFeedCron, type StatusPayload } from "../institutions/live-channel.ts";
import type { ResearchRun, ScoredRepo } from "./types.ts";
import {
  isFixtureRun,
  listRunSummaries,
  loadLatestProductionRunAnyDimension,
  loadRunFromDb,
} from "./cache.ts";
import {
  REPORT_DIR,
  CACHE_DIR,
  ROOT,
  joinPath,
  AUDIT_EVIDENCE_DIR,
  auditEvidenceAbsPath,
} from "./paths.ts";
import { JsonlChunkParser } from "../lib/jsonl.ts";
import { LIVE_TRACKER_LOG_DIR, parseTrackerJsonValue } from "../inventory/live-tracker.ts";
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
import { parseExtendedColor } from "../lib/color/kernel.ts";
import { watermarkAndSign } from "../lib/watermark-sign.ts";
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
import { attachDeskLiquidityToBoard, fetchTennisBoard, resetTennisBoardCache } from "./tennis-events.ts";
import { csrfGuard, issueCsrfSession } from "./csrf.ts";
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
import { baseCssVars, proseCss, themeToggleButton, themeChrome } from "../institutions/design-tokens.ts";
import { themeManifest } from "../lib/color/theme.ts";
import { renderWidgetPage, widgetTable as widgetTableLocal } from "../lib/widget-page.ts";
import { ingestContentItem, parseFrontmatter, renderMarkdownBody, renderMarkdownToc } from "../lib/content-pipeline.ts";
import { auditDoc } from "../lib/docs-audit.ts";
import { componentCss } from "../institutions/hq-ui.ts";
import { renderDesignPage } from "./design-page.ts";
import { renderTrendPage } from "./trend-page.ts";
import { isSafeVideoId, isVideoFile, renderVideoPage } from "./video-page.ts";
import { renderNetworkingPage } from "./networking-page.ts";
import { renderStreamsPage } from "./streams-page.ts";
import { renderObservabilityPage } from "./observability-page.ts";
import { renderPerformancePage } from "./performance-page.ts";
import { renderUtilitiesPage } from "./utilities-page.ts";
import { renderOverviewPage } from "./overview-page.ts";
import { renderToolingPage } from "./tooling-page.ts";
import { renderColorPage } from "./color-page.ts";
import { renderLivePage } from "./live-page.ts";
import { renderHashingPage } from "./hashing-page.ts";
import { renderPruningPage } from "./pruning-page.ts";
import { renderSecurityPage } from "./security-page.ts";
import { renderSpeedPage } from "./speed-page.ts";
import { renderMapPage } from "./map-page.ts";
import { renderMarkdownPage } from "./markdown-page.ts";
import { renderTranspilerPage } from "./transpiler-page.ts";
import { renderXmlPage } from "./xml-page.ts";
import { renderImagePage } from "./image-page.ts";
import { renderPluginsPage } from "./plugins-page.ts";
import { renderApiPage } from "./api-page.ts";
import { renderBrandPage } from "./brand-page.ts";
import {
  collectSignals,
  registerBlogMapCron,
  registerSignalCron,
  renderDashboard,
  runBunGate,
  type BrandMetricsSnapshot,
  type Signal,
} from "../institutions/signal-pipeline.ts";
import { CHANNEL_ACTIONS } from "../institutions/channel-registry.ts";
import { collectPipelineStatus, summarizePipelines } from "../lib/pipeline-status.ts";
import { MAPS_TOML_PATH, mapsHashOfPins, parseMapsPins } from "../lib/maps-lock.ts";
import {
  brandBadgeSvg,
  brandCardPng,
  brandCardSvg,
  brandChartSvg,
  brandQuoteSvg,
  brandSwatchPng,
  clampDim,
  transformImage,
  validateFontUrl,
} from "../lib/brand-image.ts";
import { DESIGN_SYSTEM_VERSION } from "../institutions/design-tokens.ts";
import { TOKENS as DESIGN_TOKENS } from "../institutions/design-tokens.ts";
import {
  buildBudgetHealth,
  bundleHistoryPath,
  readBundleHistory,
} from "../lib/design-budget.ts";
import { fetchKalshiBookSnapshot, midFromBookSnapshot } from "../bot/kalshi-market-data.ts";
import { asKalshiMarketTicker } from "../institutions/event-store/brands.ts";
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
  /** Event-store DB for the liquidity/KPI/partner routes (tests isolate; default DEFAULT_EVENT_STORE_DB). */
  dbPath?: string;
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

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return Response.json(data, {
    status,
    ...(extraHeaders ? { headers: extraHeaders } : {}),
  });
}

/**
 * CORS for the design-system endpoints: read-only, no credentials — any
 * origin may consume the manifest/budgets/audit + the stylesheet, so the
 * feed aggregator's admin UI (a different origin) can render the same
 * branding. Tighten with DESIGN_CORS_ORIGIN (e.g. https://admin.example.com).
 */
function designCorsHeaders(): Record<string, string> {
  return { "access-control-allow-origin": Bun.env.DESIGN_CORS_ORIGIN ?? "*" };
}

/** Brand card PNG cache (content-addressed: version×size×format×font). */
const brandCardCache = new Map<string, Uint8Array>();

/** Brand image generation metrics (fed by the routes; read at /api/brand/metrics). */
const brandMetrics = {
  card: { hits: 0, misses: 0, errors: 0, totalMs: 0 },
  swatch: { served: 0 },
  svg: { served: 0 },
  badge: { served: 0 },
  quote: { served: 0 },
  chart: { served: 0 },
  purges: 0,
};

/** Tight limiter for the WebView raster (expensive per capture). */
const brandCardLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

/** Dep-tooling health cache (the offline gates are sub-second; still cached). */
let depsHealthCache: { at: number; payload: unknown } | null = null;
const DEPS_HEALTH_TTL_MS = 60_000;

/** Signal-pipeline cache (30s — the release fetch is network). */
let signalsCache: { at: number; payload: Signal[] } | null = null;
const SIGNALS_TTL_MS = 30_000;

async function buildDepsHealth(): Promise<unknown> {
  const [dedupe, prune, audit] = await Promise.all([
    runBunGate(["dedupe", "--check"], ROOT),
    runBunGate(["prune", "--dry-run"], ROOT),
    runBunGate(["audit"], ROOT),
  ]);
  const pkg = (await Bun.file(joinPath(ROOT, "package.json")).json().catch(() => ({}))) as {
    dependencies?: Record<string, string>;
  };
  return {
    bunVersion: Bun.version,
    isolatedLinker: true, // bunfig [install] linker = "isolated"
    dedupe: { ok: dedupe.ok, detail: dedupe.detail },
    prune: { ok: prune.ok, detail: prune.detail },
    audit: { ok: audit.ok, detail: audit.detail },
    deps: Object.entries(pkg.dependencies ?? {}).map(([name, version]) => ({ name, version })),
    generatedAt: new Date().toISOString(),
  };
}

/** If-None-Match match -> 304 (ETag/conditional-request support). */
function notModified(req: Request, etag: string): Response | null {
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304 });
  }
  return null;
}

/** Functional Bun.Image probe: decode a real tiny PNG and check metadata. */
async function probeBunImage(): Promise<boolean> {
  try {
    const img = new Bun.Image(brandSwatchPng(DESIGN_TOKENS.color.acc, 8));
    const meta = await img.metadata();
    return meta.format === "png" && meta.width === 8 && meta.height === 8;
  } catch {
    return false;
  }
}

/** Swatch size clamp (solid swatches: 16-512). */
function clampSwatchSize(value: string | null, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(16, Math.min(512, Math.round(n)));
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
function handlePartnerDetail(req: Request, nodeId: string, dbPath: string = DEFAULT_EVENT_STORE_DB): Response {
  const url = new URL(req.url);
  const filters = {
    ...(url.searchParams.get("state") != null
      ? { state: url.searchParams.get("state")! }
      : {}),
    ...(url.searchParams.get("sport") != null
      ? { sport: url.searchParams.get("sport")! }
      : {}),
    ...(url.searchParams.get("market") != null
      ? { market: url.searchParams.get("market")! }
      : {}),
  };
  let deskLiquidity: ReturnType<typeof buildLiquidityBoardPayload> | null = null;
  try {
    deskLiquidity = buildLiquidityBoardPayload(openEventStore({ dbPath }), {
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
      const actorId = req.tradingPrincipal?.actorId;
      result = await executeKalshiLiveOrder(executionDb, {
        ...parsed.command,
        ...(actorId !== undefined ? { actorId } : {}),
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
// Bounded: a ticker requested once and never again would otherwise stay
// forever (recon finding, MEDIUM). Cap the map; evict oldest on overflow.
const BOOK_CACHE_MAX_ENTRIES = 512;
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
    const book = await fetchKalshiBookSnapshot(asKalshiMarketTicker(ticker), { depth });
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
    while (bookCache.size > BOOK_CACHE_MAX_ENTRIES) {
      const oldest = bookCache.keys().next().value;
      if (oldest === undefined) break;
      bookCache.delete(oldest as string); // Map preserves insertion order
    }
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
    {
      type: "MARKET_INGEST",
      payload: {
        ...(slugs !== undefined ? { slugs } : {}),
        ...(limit !== undefined ? { fetchLimit: limit } : {}),
      },
    },
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
  let creds: Awaited<ReturnType<typeof loadKalshiCredentials>> | null = null;
  try {
    creds = await loadKalshiCredentials();
  } catch {
    value = { state: "no-creds", checkedAt, cacheTtlSec: KALSHI_AUTH_CACHE_TTL_SEC };
  }
  if (creds) {
    try {
      const probe = await probeKalshiAuth(creds, {
        ...(opts.base !== undefined ? { base: opts.base } : {}),
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
    const text = (await Promise.race([
      $`launchctl list`.nothrow().quiet().then((r) => r.stdout.toString()),
      Bun.sleep(2_000).then(() => null),
    ])) as string | null;
    if (text == null) return null;
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

async function handleOpsPage(_req: Request, csrfToken: string): Promise<Response> {
  const roles = orchestrator.listRoles();
  const marketData = new MarketDataAgent(regDb);
  const launchd = await probeLaunchdLabels();
  const flows = await Promise.all(OPS_CRON_FLOWS.map((f) => readCronFlow(f, launchd)));
  const canary = await readCanaryArtifact();

  return html(
    renderOps({
      generatedAt: new Date().toISOString(),
      csrfToken,
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
      pipelines: await collectPipelineStatus(),
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
    pipelines: await collectPipelineStatus(),
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


async function handleKpi(dbPath: string = DEFAULT_EVENT_STORE_DB): Promise<Record<string, number>> {
  try {
    const store = openEventStore({ dbPath });
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

function handleLiquidityBoard(url: URL, dbPath: string = DEFAULT_EVENT_STORE_DB): Response {
  try {
    const store = openEventStore({ dbPath });
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
async function handleEventsBoard(url: URL, dbPath: string = DEFAULT_EVENT_STORE_DB): Promise<unknown> {
  const board = await fetchTennisBoard();
  let deskIndex = new Map<string, DeskLiquidityFlags>();
  try {
    const store = openEventStore({ dbPath });
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

function openLiquidityStore(dbPath: string = DEFAULT_EVENT_STORE_DB): Database {
  return openEventStore({ dbPath });
}

/** GET /api/liquidity/:eventId — optional ?recompute=1 to refresh from markets/books. */
function handleLiquidityByEvent(eventIdRaw: string, url: URL, dbPath: string = DEFAULT_EVENT_STORE_DB): Response {
  const eventId = decodeURIComponent(eventIdRaw).trim();
  if (!eventId) {
    return json({ error: "eventId required" }, 400);
  }
  try {
    const store = openLiquidityStore(dbPath);
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
function handleLiquidityByTournament(keyRaw: string, url: URL, dbPath: string = DEFAULT_EVENT_STORE_DB): Response {
  const key = decodeURIComponent(keyRaw).trim();
  if (!key) {
    return json({ error: "tournament key required" }, 400);
  }
  try {
    const store = openLiquidityStore(dbPath);
    if (url.searchParams.get("recompute") === "1") {
      recomputeMatchLiquidity(store);
    }
    const sportKey = url.searchParams.get("sport")?.trim() || undefined;
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    const rows = listMatchLiquidityByTournament(store, key, {
      ...(sportKey !== undefined ? { sportKey } : {}),
      limit,
    });
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
  // Port precedence matches Bun.serve's own env reading (probed §83):
  // explicit options.port > BUN_PORT > PORT > NODE_PORT > 3456 fallback.
  // Bun.serve auto-reads all three env vars when port is omitted; we read
  // them ourselves so the SAME precedence applies even when we pass port
  // explicitly (and so 3456 stays the repo default, not Bun's 3000).
  const envPort = Bun.env.BUN_PORT ?? Bun.env.PORT ?? Bun.env.NODE_PORT;
  const port = options.port ?? (envPort ? Number(envPort) : 3456);
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  // process.on('memoryPressure') — v1.4 low-memory notification. On
  // 'critical', drop the in-process caches so the OS doesn't kill us.
  // (Levels typed 'warning' | 'critical' in bun-types; event only shows
  // in eventNames after a listener is registered — runtime-surface probe.)
  // Under `bun --hot` the module re-evaluates WITHOUT restarting the
  // process, so a plain process.on() would ACCUMULATE one listener per
  // reload. The previous handler is kept on globalThis (which survives hot
  // reloads per bun watch-mode docs) and removed before re-adding.
  const hot = globalThis as { __kalshiMemPressureHandler?: (level: 'warning' | 'critical') => void };
  if (hot.__kalshiMemPressureHandler) {
    process.removeListener('memoryPressure', hot.__kalshiMemPressureHandler);
  }
  const onMemoryPressure = (level: 'warning' | 'critical') => {
    if (level !== 'critical') return;
    const before = bookCache.size;
    bookCache.clear();
    resetSportsSourceCatalogCache();
    resetKalshiAuthCache();
    resetTennisBoardCache();
    console.warn('memoryPressure critical: cleared ' + before + ' bookCache + source catalog + auth + tennis board caches');
  };
  hot.__kalshiMemPressureHandler = onMemoryPressure;
  process.on('memoryPressure', onMemoryPressure);
  // Live channel: WebSocket theme + feed broadcast (probe-verified in
  // AGENT-PITFALLS §23). Created before serveOptions so the websocket
  // handlers can reference it; attachServer() binds the returned server.
  const liveChannel = createLiveChannel();

  const serveOptions = {
    port,
    // Explicit loopback bind (§81): Bun 1.4.0's DEFAULT hostname is
    // "localhost" (the http-server doc claims 0.0.0.0 — WRONG on 1.4.0,
    // probed). 127.0.0.1 matches the tests and keeps this local-only;
    // set SERVE_HOSTNAME=0.0.0.0 to expose beyond loopback deliberately.
    hostname: Bun.env.SERVE_HOSTNAME ?? "127.0.0.1",
    // Hardening: Bun's defaults are a 128MB request body cap and a 10s idle
    // timeout. Legit POSTs here are KB-scale (largest: the rotor ingest), so
    // cap bodies at 16MB; extend the idle grace for the long-lived ndjson /
    // SSE streams.
    maxRequestBodySize: 16 * 1024 * 1024,
    idleTimeout: 255, // u8 max
    // WebSocket live channel (verified: server.upgrade + open/message/close
    // + ws.subscribe/server.publish broadcast). The /api/live fetch route
    // performs the upgrade; these handlers broadcast theme/feed updates.
    websocket: {
      open: (ws: import("bun").ServerWebSocket) => liveChannel.websocket.open(ws),
      message: (ws: import("bun").ServerWebSocket, msg: string | Buffer) =>
        liveChannel.websocket.message(ws, msg),
      close: (ws: import("bun").ServerWebSocket) => liveChannel.websocket.close(ws),
    },
    // Dev mode (docs: bundler-fullstack 'Development Mode' + 'Advanced
    // Development Configuration'): sourcemaps + in-browser error page +
    // HMR in dev; forward browser console.log to the terminal. Explicitly
    // OFF in production (v1.4: prod drops sourcemaps from HTML routes).
    development:
      Bun.env.NODE_ENV === 'production'
        ? false
        : { hmr: true, console: true },
    routes: {
      "/hq": hqApp,
      [ROUTES.home]: handleHome,
      [ROUTES.runsList]: handleRunsList,
      [ROUTES.runApi]: handleRunApi,
      [ROUTES.repo]: handleRepoPage,
      [ROUTES.latestReport]: handleLatestReport,
      [ROUTES.architecture]: handleArchitecture,
      // Static baked artifacts via Bun.serve dir routes (v1.4, probe-verified:
      // sendfile + Content-Type + ETag/Last-Modified + 304/412 + Range/206 +
      // index.html, openat2 O_RESOLVE_BENEATH on Linux). Replaces the
      // hand-rolled Bun.file handlers in the fallback fetch for
      // /registry/* and /partner-dashboard/*. /colors.css stays in fetch
      // (single file; a root-level /* dir route would shadow APIs).
      "/registry/*": { dir: joinPath(ROOT, "public/registry") },
      "/partner-dashboard/*": { dir: joinPath(ROOT, "public/partner-dashboard") },
      // Videos: Bun.file dir route serves Range requests with 206 + Content-
      // Range automatically (bun-v1.4 range-and-conditional-requests), so
      // <video> seeking works with zero custom code. Files stream via
      // sendfile (zero-copy). Never reference these via HTML-import relative
      // src — the bundler inlines small assets as data: URLs.
      "/videos/*": { dir: joinPath(ROOT, "public/videos") },
      // Blog-map asset mirror (public/blog/, regenerated by `bun run blog:assets`):
      // the tracked Bun release-blog map + state + reports served offline, so
      // nothing hotlinks bun.sh. /blog/index.json is the machine-readable manifest.
      "/blog/*": { dir: joinPath(ROOT, "public/blog") },
      // Exact route (beats param): machine-readable video manifest.
      "/videos/index.json": async () => {
        const vidsDir = joinPath(ROOT, "public/videos");
        const names = [...new Bun.Glob("*").scanSync({ cwd: vidsDir, onlyFiles: true })].filter(isVideoFile);
        const videos = (
          await Promise.all(
            names.map(async (name) => ({ name, bytes: Bun.file(joinPath(vidsDir, name)).size })),
          )
        ).sort((a, b) => a.name.localeCompare(b.name));
        return json({ count: videos.length, videos }, 200, designCorsHeaders());
      },
      // Parameterized route (beats wildcard for single segments): serves one
      // video by name with traversal-safe validation; Bun.file() bodies still
      // get Range/206 + content-type automatically.
      "/videos/:id": async (req: Request) => {
        const id = (req as unknown as { params: Record<string, string> }).params.id!;
        if (!isSafeVideoId(id)) {
          return json({ error: "invalid video name" }, 404, designCorsHeaders());
        }
        const file = Bun.file(joinPath(ROOT, "public/videos", id));
        if (!(await file.exists())) {
          return json({ error: "video not found" }, 404, designCorsHeaders());
        }
        return new Response(file, { headers: designCorsHeaders() });
      },
    },
    async fetch(req: Request, server: import("bun").Server<undefined>) {
      const url = new URL(req.url);

      // Live channel upgrade: /api/live -> WebSocket (theme + feed).
      // server.upgrade returns true when the handshake succeeds; the
      // websocket handlers above take over from here.
      if (url.pathname === "/api/live") {
        const upgraded = server.upgrade(req);
        return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
      }

      // ── URLPattern routes (parameterized) — SERVE_PATTERNS in patterns.ts ──
      // @see https://bun.com/blog/bun-v1.3.4#urlpattern-api
      {
        const g = SERVE_PATTERNS.opsPartner.groups(url);
        if (g?.nodeId) {
          return rateLimiter(req, () => handlePartnerDetail(req, g.nodeId!, dbPath));
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
        return handleLiquidityBoard(url, dbPath);
      }
      // Derived from markets + book_ticks — no rateLimiter
      {
        const g = SERVE_PATTERNS.liquidityByEvent.groups(url);
        if (g?.eventId && g.eventId !== "summary" && g.eventId !== "by-tournament") {
          return handleLiquidityByEvent(g.eventId!, url, dbPath);
        }
      }
      {
        const g = SERVE_PATTERNS.liquidityByTournament.groups(url);
        if (g?.key) {
          return handleLiquidityByTournament(g.key!, url, dbPath);
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
        return json(await handleKpi(dbPath));
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

      // Design-system bundle (dist/design-system.js, built by design:build)
      // — the reusable TOKENS + color kernel artifact for external consumers.
      // dist/ is gitignored; a 404 tells the operator to run the build.
      if (url.pathname === "/design-system.js") {
        const file = Bun.file(joinPath(ROOT, "dist/design-system.js"));
        if (!(await file.exists())) {
          return new Response("design-system.js missing — run bun run design:build", { status: 404 });
        }
        return new Response(file, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-cache",
            ...designCorsHeaders(),
          },
        });
      }

      // Design-system CSS: token vars + component base styles as one
      // cacheable stylesheet (renderHq links it instead of inlining). The
      // body is deterministic per TOKENS/hq-ui version — computed, not
      // stored, so it can never drift from the source of truth.
      if (url.pathname === "/design-system.css") {
        return new Response(baseCssVars() + componentCss() + proseCss(), {
          headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "no-cache",
            ...designCorsHeaders(),
          },
        });
      }

      // ── Brand image endpoints (production-readied) ───────────────────────
      // Rate-limited, param-validated (400), ETag/If-None-Match (304), CORS,
      // metrics. SVG inputs are server-generated (no user SVG — no script
      // injection surface). Metrics feed /api/brand/metrics.

      // Brand card SVG (cheap, token-built) — ETag by design version.
      if (url.pathname === "/brand.svg") {
        return rateLimiter(req, () => {
          brandMetrics.svg.served += 1;
          const etag = '"svg-v' + DESIGN_SYSTEM_VERSION + '"';
          const nm = notModified(req, etag);
          if (nm) return nm;
          return new Response(brandCardSvg(), {
            headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-cache", etag, ...designCorsHeaders() },
          });
        });
      }

      // Rasterized brand card (Bun.WebView) — content-addressed cache,
      // validated params (w/h clamped 100-4000, format whitelist, font URL),
      // tighter rate limit (WebView capture is expensive).
      if (url.pathname === "/brand/card.png") {
        return brandCardLimiter(req, async () => {
          const sp = url.searchParams;
          const width = clampDim(sp.get("w"), 1200);
          const height = clampDim(sp.get("h"), 630);
          const formatRaw = sp.get("format") ?? "png";
          if (!["png", "jpeg", "webp", "avif"].includes(formatRaw)) {
            return json({ error: "invalid format — png|jpeg|webp|avif" }, 400, designCorsHeaders());
          }
          const fontUrl = validateFontUrl(sp.get("font") ?? undefined);
          if (sp.has("font") && !fontUrl) {
            return json({ error: "invalid font URL (https, non-localhost)" }, 400, designCorsHeaders());
          }
          const cacheKey = DESIGN_SYSTEM_VERSION + "-" + width + "x" + height + "-" + formatRaw + "-" + (fontUrl ?? "sys");
          let png = brandCardCache.get(cacheKey);
          const t0 = performance.now();
          if (!png) {
            brandMetrics.card.misses += 1;
            const captured = await brandCardPng({
              width,
              height,
              ...(fontUrl != null ? { font: fontUrl } : {}),
            });
            if (!captured) {
              brandMetrics.card.errors += 1;
              return new Response("brand card unavailable (Bun.WebView required)", { status: 503, headers: designCorsHeaders() });
            }
            if (formatRaw !== "png") {
              const converted = await transformImage(captured, { format: formatRaw as "jpeg" | "webp" | "avif", quality: 85 });
              png = await converted.image.bytes();
            } else {
              png = captured;
            }
            brandCardCache.set(cacheKey, png);
          } else {
            brandMetrics.card.hits += 1;
          }
          brandMetrics.card.totalMs += performance.now() - t0;
          const etag = '"' + cacheKey + '"';
          const nm = notModified(req, etag);
          if (nm) return nm;
          return new Response(new Blob([png as unknown as BlobPart], { type: "image/" + formatRaw }), {
            headers: { "content-type": "image/" + formatRaw, "cache-control": "public, max-age=300", etag, ...designCorsHeaders() },
          });
        });
      }

      // Solid token-color swatch PNGs (semantic colors as real images).
      if (url.pathname.startsWith("/brand/swatch/") && url.pathname.endsWith(".png")) {
        return rateLimiter(req, () => {
          const token = url.pathname.slice("/brand/swatch/".length, -".png".length);
          const SWATCH_TOKENS: Record<string, string> = {
            bg: DESIGN_TOKENS.color.bg, panel: DESIGN_TOKENS.color.panel, panel2: DESIGN_TOKENS.color.panel2,
            line: DESIGN_TOKENS.color.line, fg: DESIGN_TOKENS.color.fg, dim: DESIGN_TOKENS.color.dim,
            acc: DESIGN_TOKENS.color.acc, ok: DESIGN_TOKENS.color.ok, warn: DESIGN_TOKENS.color.warn,
            bad: DESIGN_TOKENS.color.bad,
            // Unified theme roles (src/lib/color/theme.ts) — same one vocabulary.
            primary: DESIGN_TOKENS.color.acc, secondary: DESIGN_TOKENS.color.ok,
            accent: DESIGN_TOKENS.color.warn, success: DESIGN_TOKENS.color.ok,
            warning: DESIGN_TOKENS.color.warn, error: DESIGN_TOKENS.color.bad,
            info: DESIGN_TOKENS.color.acc, background: DESIGN_TOKENS.color.bg,
            foreground: DESIGN_TOKENS.color.fg, muted: DESIGN_TOKENS.color.dim,
            border: DESIGN_TOKENS.color.line, onAccent: DESIGN_TOKENS.color.onAccent,
          };
          const color = SWATCH_TOKENS[token];
          if (!color) {
            return json({ error: "unknown token — try acc, ok, warn, bad, bg, panel, fg, dim" }, 404, designCorsHeaders());
          }
          const size = clampSwatchSize(url.searchParams.get("size"), 64);
          brandMetrics.swatch.served += 1;
          const etag = '"swatch-' + token + '-' + size + '"';
          const nm = notModified(req, etag);
          if (nm) return nm;
          const pngBlob = new Blob([brandSwatchPng(color, size) as unknown as BlobPart], { type: "image/png" });
          return new Response(pngBlob, {
            headers: { "content-type": "image/png", "cache-control": "public, max-age=3600", etag, ...designCorsHeaders() },
          });
        });
      }

      // Template cards (badge / quote / chart) — validated params, ETag.
      if (url.pathname === "/brand/badge.svg") {
        return rateLimiter(req, () => {
          const tone = url.searchParams.get("tone") ?? "ok";
          if (!["ok", "warn", "bad", "dim"].includes(tone)) {
            return json({ error: "invalid tone — ok|warn|bad|dim" }, 400, designCorsHeaders());
          }
          const text = url.searchParams.get("text") ?? "";
          brandMetrics.badge.served += 1;
          const etag = '"badge-' + tone + '-' + text + '"';
          const nm = notModified(req, etag);
          if (nm) return nm;
          return new Response(brandBadgeSvg(tone as "ok" | "warn" | "bad" | "dim", text), {
            headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60", etag, ...designCorsHeaders() },
          });
        });
      }
      if (url.pathname === "/brand/quote.svg") {
        return rateLimiter(req, () => {
          const quote = url.searchParams.get("quote") ?? "";
          const by = url.searchParams.get("by") ?? "";
          brandMetrics.quote.served += 1;
          const etag = '"quote-' + quote + '-' + by + '"';
          const nm = notModified(req, etag);
          if (nm) return nm;
          return new Response(brandQuoteSvg(quote, by), {
            headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60", etag, ...designCorsHeaders() },
          });
        });
      }
      if (url.pathname === "/brand/chart.svg") {
        return rateLimiter(req, () => {
          const raw = url.searchParams.get("values") ?? "";
          if (!raw.trim()) {
            return json({ error: "values required: comma-separated numbers (1-12)" }, 400, designCorsHeaders());
          }
          const values = raw.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
          if (!values.length || values.length > 12) {
            return json({ error: "values required: comma-separated numbers (1-12)" }, 400, designCorsHeaders());
          }
          brandMetrics.chart.served += 1;
          const etag = '"chart-' + values.join(",") + '"';
          const nm = notModified(req, etag);
          if (nm) return nm;
          return new Response(brandChartSvg(values), {
            headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=60", etag, ...designCorsHeaders() },
          });
        });
      }

      // NOTE: /registry/* and /partner-dashboard/* static files are now
      // served by the routes dir mounts above (sendfile + ETag + Range +
      // 304, probe-verified); the hand-rolled Bun.file handlers were
      // removed. /colors.css remains here (single root-level file).

      // Liveness + capability probe: also verifies Bun.Image (functional
      // decode of a real PNG) and Bun.WebView (presence) so tunnels/CI know
      // the brand-image pipeline is genuinely working, not just up.
      if (url.pathname === "/health") {
        const imageOk = await probeBunImage();
        return json({
          status: "ok",
          pid: process.pid,
          uptime: process.uptime(),
          features: { image: imageOk, webview: typeof Bun.WebView === "function" },
        });
      }

      // Repo docs served through the SAME markdown pipeline: render via
      // Bun.markdown.html + native TOC + content-addressed ETag/304.
      if (url.pathname === "/docs") {
        const names = [...new Bun.Glob("*.md").scanSync({ cwd: joinPath(ROOT, "docs"), onlyFiles: true })].sort();
        const rows = await Promise.all(
          names.map(async (f) => {
            const d = await auditDoc(joinPath(ROOT, "docs", f), "docs/" + f);
            return { cells: ['<a href="/docs/' + f.replace(/\.md$/, "") + '">' + f + '</a>', String(d.headings) + ' headings', d.bytes + ' B', '<code>' + d.hash.slice(0, 12) + '</code>'] };
          }),
        );
        const page = renderWidgetPage({
          title: 'Repo Docs',
          subtitle: 'docs/*.md rendered via Bun.markdown — native heading ids, ETag/304 (docs:check contract, §38)',
          badges: [names.length + ' docs', 'Bun.markdown', 'ETag/304'],
          links: ['/bun/markdown', '/content/posts'],
          sections: [{ heading: 'All docs', html: widgetTableLocal(['Doc', 'Headings', 'Bytes', 'sha256'], rows) }],
          footer: 'Contract: every doc renders with unique heading ids (bun run docs:check).',
        });
        return new Response(page, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...designCorsHeaders() },
        });
      }
      if (url.pathname.startsWith("/docs/")) {
        const name = url.pathname.slice("/docs/".length);
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.includes("..")) return json({ error: "invalid doc" }, 404, designCorsHeaders());
        const rel = "docs/" + name + ".md";
        const abs = joinPath(ROOT, rel);
        if (!(await Bun.file(abs).exists())) return json({ error: "doc not found" }, 404, designCorsHeaders());
        const audit = await auditDoc(abs, rel);
        const nm = notModified(req, '"' + audit.hash + '"');
        if (nm) return nm;
        const text = await Bun.file(abs).text();
        const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
        const page = renderWidgetPage({
          title: name,
          subtitle: rel + ' · ' + audit.headings + ' headings · ' + audit.hash.slice(0, 12),
          badges: ['Bun.markdown', '"' + audit.hash.slice(0, 12) + '"'],
          links: ['/docs'],
          sections: [
            ...(renderMarkdownToc(body) ? [{ heading: 'Contents', html: renderMarkdownToc(body) }] : []),
            { heading: name, html: renderMarkdownBody(body) },
          ],
          footer: 'Docs contract: render via Bun.markdown with unique heading ids (docs:check).',
        });
        return new Response(page, {
          headers: { "content-type": "text/html; charset=utf-8", etag: '"' + audit.hash + '"', "cache-control": "public, max-age=60", ...designCorsHeaders() },
        });
      }

      // Content pipeline: markdown posts -> frontmatter -> SHA-256 -> ETag.
      // ETag is the quoted content hash; If-None-Match -> 304 (notModified
      // helper, probe-verified conditional GET — the same pattern the
      // /brand routes use).
      if (url.pathname === "/content/posts") {
        const files = [...new Bun.Glob("*.md").scanSync({ cwd: joinPath(ROOT, "content/posts"), onlyFiles: true })];
        const items = await Promise.all(
          files.sort().map((f) => ingestContentItem(joinPath(ROOT, "content/posts", f))),
        );
        const rows = items.map((it) => ({
          cells: [
            '<a href="/content/posts/' + encodeURIComponent(it.id) + '">' + it.title + '</a>',
            '<code>' + it.id + '</code>',
            it.pubDate.slice(0, 10),
            '<code>' + it.etag + '</code>',
          ],
        }));
        const page = renderWidgetPage({
          title: 'Content Pipeline',
          subtitle: 'Markdown posts -> frontmatter -> SHA-256 -> ETag/304 — zero deps, probe-verified',
          badges: ['sha256', 'ETag/304', 'conditional GET'],
          links: ['/bun/hashing', '/content/posts/hello-world.md'],
          sections: [
            { heading: 'Posts (content-addressed)', html: widgetTableLocal(['Title', 'slug', 'date', 'ETag'], rows) },
          ],
          footer: 'Probes: docs/AGENT-PITFALLS.md §24.',
        });
        return new Response(page, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60", ...designCorsHeaders() },
        });
      }
      if (url.pathname.startsWith("/content/posts/") && url.pathname.endsWith(".md")) {
        const name = url.pathname.slice("/content/posts/".length, -".md".length);
        if (!/^[A-Za-z0-9-]+$/.test(name)) return json({ error: "invalid post name" }, 404, designCorsHeaders());
        const file = Bun.file(joinPath(ROOT, "content/posts", name + ".md"));
        if (!(await file.exists())) return json({ error: "post not found" }, 404, designCorsHeaders());
        const item = await ingestContentItem(joinPath(ROOT, "content/posts", name + ".md"));
        const nm = notModified(req, item.etag);
        if (nm) return nm;
        return new Response(file, {
          headers: { "content-type": "text/markdown; charset=utf-8", etag: item.etag, "cache-control": "public, max-age=60", ...designCorsHeaders() },
        });
      }
      if (url.pathname.startsWith("/content/posts/")) {
        const name = url.pathname.slice("/content/posts/".length);
        if (!/^[A-Za-z0-9-]+$/.test(name)) return json({ error: "invalid post name" }, 404, designCorsHeaders());
        const item = await ingestContentItem(joinPath(ROOT, "content/posts", name + ".md")).catch(() => null);
        if (!item) return json({ error: "post not found" }, 404, designCorsHeaders());
        const nm = notModified(req, item.etag);
        if (nm) return nm;
        const page = renderWidgetPage({
          title: item.title,
          subtitle: item.id + ' · ' + item.pubDate.slice(0, 10) + ' · ' + item.etag,
          badges: ['sha256', item.etag],
          links: ['/content/posts', '/content/posts/' + encodeURIComponent(item.id) + '.md'],
          // Bun.markdown.html — probe-verified real HTML (§27); raw body is
          // our own trusted content.
          sections: [
            { heading: item.title, html: renderMarkdownBody(item.body) },
            ...(renderMarkdownToc(item.body) ? [{ heading: 'Contents', html: renderMarkdownToc(item.body) }] : []),
          ],
          footer: 'Content-addressed: ETag = quoted SHA-256 of the raw file · rendered via Bun.markdown.html',
        });
        return new Response(page, {
          headers: { "content-type": "text/html; charset=utf-8", etag: item.etag, "cache-control": "public, max-age=60", ...designCorsHeaders() },
        });
      }

      // Bun capability widget pages (token-built, probe-verified claims).
      const BUN_WIDGETS: Record<string, () => string> = {
        "/bun/networking": renderNetworkingPage,
        "/bun/streams": renderStreamsPage,
        "/bun/observability": renderObservabilityPage,
        "/bun/performance": renderPerformancePage,
        "/bun/utilities": renderUtilitiesPage,
        "/bun/overview": renderOverviewPage,
        "/bun/tooling": renderToolingPage,
        "/bun/color": renderColorPage,
        "/bun/live": renderLivePage,
        "/bun/hashing": renderHashingPage,
        "/bun/pruning": renderPruningPage,
        "/bun/security": renderSecurityPage,
        "/bun/speed": renderSpeedPage,
        "/bun/map": renderMapPage,
        "/bun/markdown": renderMarkdownPage,
        "/bun/transpiler": renderTranspilerPage,
        "/bun/xml": renderXmlPage,
        "/bun/image": renderImagePage,
        "/bun/plugins": renderPluginsPage,
        "/bun/api": renderApiPage,
        "/bun/brand": renderBrandPage,
      };
      if (url.pathname in BUN_WIDGETS) {
        const page = BUN_WIDGETS[url.pathname]!();
        const themed = page.includes('</body>')
          ? page.replace('</body>', themeToggleButton() + themeChrome() + '</body>')
          : page;
        return new Response(themed, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...designCorsHeaders() },
        });
      }

      // Branded video page — lists public/videos and plays them via the
      // /videos/* dir route (Range/206 seeking handled by Bun.serve).
      if (url.pathname === "/videos") {
        const vidsDir = joinPath(ROOT, "public/videos");
        const names = [...new Bun.Glob("*").scanSync({ cwd: vidsDir, onlyFiles: true })].filter(isVideoFile);
        return new Response(renderVideoPage(names), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...designCorsHeaders() },
        });
      }

      // Brand metrics: generation time, cache hit/miss, error rate.
      if (url.pathname === "/api/brand/metrics") {
        return rateLimiter(req, () =>
          json({ ...brandMetrics, cardCacheSize: brandCardCache.size }, 200, designCorsHeaders()),
        );
      }

      // Dep-tooling health: the offline gates (dedupe --check, prune
      // --dry-run, audit) + the isolated-linker state — cached 60s, the same
      // data the /bun/tooling page documents.
      if (url.pathname === "/api/deps/health") {
        return rateLimiter(req, async () => {
          const now = Date.now();
          if (!depsHealthCache || now - depsHealthCache.at > DEPS_HEALTH_TTL_MS) {
            depsHealthCache = { at: now, payload: await buildDepsHealth() };
          }
          return json(depsHealthCache.payload, 200, designCorsHeaders());
        });
      }

      // ── Signal pipeline: multi-source dashboard hub ────────────────────
      // Shared collector: design budgets + deps gates + brand metrics +
      // release feeds (RSS+Atom) + ops. Cached 30s (the feeds are network).
      const brandSnap: BrandMetricsSnapshot = {
        card: { hits: brandMetrics.card.hits, misses: brandMetrics.card.misses, errors: brandMetrics.card.errors, totalMs: brandMetrics.card.totalMs },
        swatch: { served: brandMetrics.swatch.served },
        svg: { served: brandMetrics.svg.served },
        badge: { served: brandMetrics.badge.served },
        quote: { served: brandMetrics.quote.served },
        chart: { served: brandMetrics.chart.served },
        purges: brandMetrics.purges,
      };
      const signalsNow = async (): Promise<Signal[]> => {
        const now = Date.now();
        if (!signalsCache || now - signalsCache.at > SIGNALS_TTL_MS) {
          signalsCache = { at: now, payload: await collectSignals(ROOT, brandSnap) };
        }
        return signalsCache.payload;
      };
      // NOTE: the shared refreshSignalsCache (used by signalsNow + the
      // Bun.cron job) is defined in createResearchServer scope near the end —
      // closures resolve it by reference.

      // The dashboard page (token-built; issues the CSRF session for buttons).
      if (url.pathname === "/dashboard") {
        const session = issueCsrfSession(req);
        const signals = await signalsNow();
        const page = new Response(renderDashboard(signals, session.token), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...designCorsHeaders() },
        });
        page.headers.set("Set-Cookie", session.sessionCookie);
        return page;
      }

      // The pipeline as JSON (machine-readable; CORS for other UIs).
      if (url.pathname === "/api/signals") {
        return rateLimiter(req, async () => json(await signalsNow(), 200, designCorsHeaders()));
      }

      // Liveness/readiness: aggregate signal health into a boolean + counts.
      // 200 when no 'bad' signal (warn = degraded but serving), 503 when a
      // bad signal exists (a gate failed). Reuses the same 30s signals cache;
      // rate-limited + CORS like the rest. Uptime + bunVersion for monitors.
      if (url.pathname === "/status" || url.pathname === "/healthz") {
        return rateLimiter(req, async () => {
          const signals = await signalsNow();
          const counts = { ok: 0, warn: 0, bad: 0, info: 0 };
          for (const s of signals) counts[s.severity] += 1;
          const ok = counts.bad === 0;
          const pipelines = await collectPipelineStatus();
          const pip = summarizePipelines(pipelines);
          // Live maps.toml triple-lock hash (never a placeholder).
          const mapsText = await Bun.file(MAPS_TOML_PATH).text().catch(() => "");
          const mapsPins = mapsText ? parseMapsPins(Bun.TOML.parse(mapsText)) : null;
          const body = {
            ok,
            status: ok ? "ok" : "degraded",
            bunVersion: Bun.version,
            uptimeMs: Math.round(process.uptime() * 1000),
            checkedAt: new Date().toISOString(),
            signals: signals.length,
            channels: counts,
            failing: signals.filter((s) => s.severity === "bad").map((s) => ({ id: s.id, title: s.title })),
            pipelines: pip,
            bun14: {
              version: Bun.version,
              revision: Bun.revision.slice(0, 8),
              docsPages: mapsPins?.docsPages ?? 0,
              mapsLock: mapsPins ? mapsHashOfPins(mapsPins) : null,
              mapsPins: mapsPins
                ? { bun: mapsPins.bunVersion, ref: mapsPins.docsRef, scope: mapsPins.docsScope }
                : null,
            },
          };
          return json(body, ok ? 200 : 503, designCorsHeaders());
        });
      }

      // Actions: purge brand cache / run deps gates / regenerate card /
      // refresh release check — POST, CSRF + rate limited.
      if (url.pathname.startsWith("/api/signals/actions/") && req.method === "POST") {
        const name = url.pathname.slice("/api/signals/actions/".length);
        return csrfGuard(req, () =>
          rateLimiter(req, async () => {
            if (name === "purge-brand") {
              brandCardCache.clear();
              brandMetrics.purges += 1;
              return json({ ok: true, action: name, cacheSize: brandCardCache.size }, 200, designCorsHeaders());
            }
            if (name === "deps-check") {
              const [dedupe, prune] = await Promise.all([
                runBunGate(["dedupe", "--check"], ROOT),
                runBunGate(["prune", "--dry-run"], ROOT),
              ]);
              return json({ ok: dedupe.ok && prune.ok, action: name, dedupe, prune }, 200, designCorsHeaders());
            }
            if (name === "brand-card") {
              const png = await brandCardPng({ width: 1200, height: 630 });
              if (png) {
                brandCardCache.set(DESIGN_SYSTEM_VERSION + "-1200x630-png-sys", png);
                return json({ ok: true, action: name, bytes: png.length }, 200, designCorsHeaders());
              }
              return new Response("brand card capture failed (WebKit busy?)", { status: 503, headers: designCorsHeaders() });
            }
            if (name === "release-check") {
              const p = Bun.spawn([Bun.which("bun") ?? "bun", "run", "bun:release-watch", "--", "--check"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
              const out = await new Response(p.stdout).text();
              await p.exited;
              return json({ ok: (p.exitCode ?? 1) === 0, action: name, out: out.trim().split("\n").slice(0, 3) }, 200, designCorsHeaders());
            }
            // Docs-quality gates (§67 actions): run the gate, report ok +
            // last lines. All are sub-second; docs:refresh is the network
            // exception (re-indexes the 333-page cache + heals the lock).
            if (name === "docs:check" || name === "docs:api" || name === "docs:integrity" || name === "output:probe" || name === "blog-map" || name === "content-check" || name === "licenses:gate" || name === "docs:refresh") {
              const script: string =
                name === "docs:check" ? "docs:check" :
                name === "docs:api" ? "docs:api" :
                name === "docs:integrity" ? "docs:integrity" :
                name === "output:probe" ? "output:probe" :
                name === "blog-map" ? "bun:blog-map" :
                name === "docs:refresh" ? "docs:refresh" :
                name === "content-check" ? "content:check" : "licenses:gate";
              const extra = name === "blog-map" ? ["--", "--offline"] : name === "content-check" ? ["--", "--check"] : [];
              const p = Bun.spawn([Bun.which("bun") ?? "bun", "run", script, ...extra], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
              const out = await new Response(p.stdout).text();
              await p.exited;
              return json({ ok: (p.exitCode ?? 1) === 0, action: name, out: out.trim().split("\n").slice(-2) }, 200, designCorsHeaders());
            }
            // Action allowlist comes from the channel registry SSOT —
            // never a hardcoded list here.
            return json({ error: "unknown action — " + CHANNEL_ACTIONS.join(" | ") }, 404, designCorsHeaders());
          }),
        );
      }

      // Admin: purge the brand image caches (POST, CSRF + rate limited).
      if (url.pathname === "/brand/purge" && req.method === "POST") {
        return csrfGuard(req, () =>
          rateLimiter(req, () => {
            brandCardCache.clear();
            brandMetrics.purges += 1;
            return json({ purged: true, cacheSize: brandCardCache.size }, 200, designCorsHeaders());
          }),
        );
      }
      if (url.pathname === "/api/hq") {
        return json(await buildHqPayload());
      }

      // Tennis event board — all open match events w/ nested markets (60s cache)
      // + desk match_liquidity flags for HQ filters/badges.
      // Query: ?liquidity=all|priced|active|quoted|liq_ok|tradable&minVolume=N
      if (url.pathname === "/api/events") {
        return json(await handleEventsBoard(url, dbPath));
      }

      // Player profiles derived from the event store
      if (url.pathname === "/api/profiles") {
        const sortParam = url.searchParams.get("sort");
        const sort = sortParam === "appearances" ? "appearances" : "volume";
        return json(
          readPlayerProfiles({
            limit: Number(url.searchParams.get("limit") ?? 50),
            ...(url.searchParams.get("search") != null
              ? { search: url.searchParams.get("search")! }
              : {}),
            sort,
          }),
        );
      }

      // Player↔opponent head-to-head (volume per matchup) from the event store
      if (url.pathname === "/api/opponent-profiles") {
        return json(
          readOpponentProfiles({
            limit: Number(url.searchParams.get("limit") ?? 50),
            ...(url.searchParams.get("player") != null
              ? { player: url.searchParams.get("player")! }
              : {}),
            ...(url.searchParams.get("opponent") != null
              ? { opponent: url.searchParams.get("opponent")! }
              : {}),
          }),
        );
      }

      // ── Streaming NDJSON endpoints (Bun.JSONL pipeline) ───────────────────
      // Committed audit evidence as NDJSON. ?repo=owner__name → one file;
      // no param → all evidence files concatenated (still valid NDJSON).
      if (url.pathname === "/api/audit.jsonl") {
        const repo = url.searchParams.get("repo");
        if (repo) {
          const f = Bun.file(auditEvidenceAbsPath(repo));
          if (!(await f.exists())) {
            return json({ error: "no audit evidence for repo", repo }, 404);
          }
          return new Response(f.stream(), {
            headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
          });
        }
        const files = [] as ReturnType<typeof Bun.file>[];
        const auditGlob = new Bun.Glob("*.jsonl");
        for await (const name of auditGlob.scan({ cwd: AUDIT_EVIDENCE_DIR })) {
          files.push(Bun.file(joinPath(AUDIT_EVIDENCE_DIR, name)));
        }
        const auditBody = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const f of files) {
              for await (const chunk of f.stream()) controller.enqueue(chunk);
            }
            controller.close();
          },
        });
        return new Response(auditBody, {
          headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        });
      }

      // Live-tracker event logs streamed through JsonlChunkParser
      // (server-side parseChunk pipeline). ?file=<name>&event-type=TYPE&limit=N
      if (url.pathname === "/api/events.jsonl") {
        const file = url.searchParams.get("file") ?? "";
        // Path traversal guard (server-audit finding): ?file= must be a
        // bare log NAME inside LIVE_TRACKER_LOG_DIR - reject any path
        // separator, dot-dot, or empty/absolute input before joinPath.
        if (!/^[A-Za-z0-9._-]+$/.test(file)) {
          return json({ error: "invalid log file name: " + file.slice(0, 80) }, 400);
        }
        const eventType = url.searchParams.get("event-type");
        const limit = Math.max(0, Number(url.searchParams.get("limit") ?? "0") || 0);
        const f = Bun.file(joinPath(LIVE_TRACKER_LOG_DIR, file));
        if (!file || !(await f.exists())) {
          const available: string[] = [];
          const evGlob = new Bun.Glob("*.jsonl");
          for await (const name of evGlob.scan({ cwd: LIVE_TRACKER_LOG_DIR })) {
            available.push(name);
          }
          return json(
            { error: "no such log file: " + (file || "(none)"), available: available.slice(-10) },
            404,
          );
        }
        const parser = new JsonlChunkParser();
        const enc = new TextEncoder();
        const evBody = new ReadableStream<Uint8Array>({
          async start(controller) {
            let emitted = 0;
            // Normalize each raw log row (watch update / event / doc) to
            // LiveTrackerEvent via the lib SSOT, then filter + re-emit NDJSON.
            const emit = (row: unknown): boolean => {
              for (const ev of parseTrackerJsonValue(row, file)) {
                if (eventType && ev.eventType !== eventType) continue;
                controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
                emitted++;
                if (limit && emitted >= limit) return false;
              }
              return !limit || emitted < limit;
            };
            for await (const chunk of f.stream()) {
              for (const v of parser.feed(new Uint8Array(chunk))) {
                if (!emit(v)) { controller.close(); return; }
              }
            }
            for (const v of parser.finish()) {
              if (!emit(v)) { controller.close(); return; }
            }
            controller.close();
          },
        });
        return new Response(evBody, {
          headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        });
      }

      // Ops dashboard (read-only management page) — issues the CSRF session
      if (url.pathname === "/ops") {
        const session = issueCsrfSession(req);
        const page = await handleOpsPage(req, session.token);
        page.headers.set("Set-Cookie", session.sessionCookie);
        return page;
      }

      // Ops dashboard JSON companion — same CSRF cookie so JSON clients can POST
      if (url.pathname === "/ops.json") {
        const session = issueCsrfSession(req);
        const res = await handleOpsJson(req);
        res.headers.set("Set-Cookie", session.sessionCookie);
        return res;
      }

      // /ops/partners/:nodeId — SERVE_PATTERNS.opsPartner (above)

      // Bet placement — CSRF first, then rate limit, then compliance gate
      if (url.pathname === "/place-bet" && req.method === "POST") {
        return csrfGuard(req, () => rateLimiter(req, () => stateValidator(req, () => complianceGate(req, () => handlePlaceBet(req)))));
      }

      // HQ order entry — CSRF, then same middleware stack as /place-bet
      if (url.pathname === "/api/trading/order" && req.method === "POST") {
        return csrfGuard(req, () => rateLimiter(req, () => requireTradingOrderPrincipal(req, () => stateValidator(req, () => executionComplianceGate(req, () => handleTradingOrder(req, options.trading))))));
      }

      // HQ order cancel
      if (url.pathname === "/api/trading/cancel" && req.method === "POST") {
        return csrfGuard(req, () => rateLimiter(req, () => requireTradingCancelPrincipal(req, () => handleTradingCancel(req, options.trading))));
      }

      // HQ orderbook preview (public market data)
      if (url.pathname === "/api/trading/book") {
        return rateLimiter(req, () => handleTradingBook(req));
      }

      // Design system manifest (tokens, components, brand) + LIVE health:
      // bundle budgets and a token-audit summary ride along, so one call
      // carries the whole design-system state (brand → tokens → components →
      // bundles → compliance).
      if (url.pathname === "/api/design") {
        const health = await buildBudgetHealth(ROOT);
        const surfaces = await Promise.all([
          renderHq(),
          ...["index.html", "styles.css", "app.js", "color-vars.css"].map((f) =>
            Bun.file(joinPath(joinPath(ROOT, "src/research/hq-app"), f)).text().catch(() => ""),
          ),
        ]);
        const audit = designAgent.audit(...surfaces);
        return json(
          {
            ...designAgent.manifest(),
            budgets: health,
            audit: { ok: audit.ok, issues: audit.issues.length },
          },
          200,
          designCorsHeaders(),
        );
      }

      // Unified color theme as JSON: roles -> hex/css/ansi + WCAG contrast.
      // One call carries terminal codes, web CSS vars, and the contrast math.
      // Advanced color parsing: /api/color-info?color=lab(50% 50 50)
      // Bun.color 1.4.0 parses hex/hwb/color-mix etc.; the extended CSS Color 4
      // formats (lab/lch/oklab/oklch/hsv) are parsed by the kernel inverse
      // parsers (Bun.color returns null for them — probe-verified).
      // Watermark + sign pipeline: /api/watermark?text=...&url=...&width=...
      // SVG → Bun.WebView screenshot (text overlay — Bun has no Canvas) →
      // ml-dsa-65 signature. PNG body + x-signature (hex) + x-public-key
      // (base64 SPKI PEM) + x-key-type headers.
      if (url.pathname === "/api/watermark") {
        const text = url.searchParams.get("text") ?? "";
        const imgUrl = url.searchParams.get("url");
        const width = Number(url.searchParams.get("width") ?? 400) || 400;
        if (!text) return json({ ok: false, error: "missing text" }, 400, designCorsHeaders());
        try {
          let imageDataUrl: string | undefined;
          if (imgUrl) {
            const r = await fetch(imgUrl, { protocol: "http2" });
            if (r.ok) {
              const img = new Bun.Image(await r.arrayBuffer()).resize(width);
              const b = await img.png().bytes();
              imageDataUrl = "data:image/png;base64," + Buffer.from(b).toString("base64");
            }
          }
          const asset = await watermarkAndSign({ text, ...(imageDataUrl ? { imageDataUrl } : {}), width, height: width });
          return new Response(new Blob([Buffer.from(asset.png)]), {
            headers: {
              "content-type": "image/png",
              "x-signature": Buffer.from(asset.signature).toString("hex"),
              "x-public-key": Buffer.from(asset.publicKeyPem).toString("base64"),
              "x-key-type": asset.keyType,
              ...designCorsHeaders(),
            },
          });
        } catch (e) {
          return json({ ok: false, error: String(e).slice(0, 120) }, 500, designCorsHeaders());
        }
      }

      if (url.pathname === "/api/color-info") {
        const raw = url.searchParams.get("color") ?? "";
        if (!raw) return json({ ok: false, error: "missing color" }, 400, designCorsHeaders());
        // Native first: Bun.color parses hex/hwb/color-mix/lab/lch (guide input
        // list + runtime probe). Kernel fallback covers oklab/oklch/hsv, which
        // Bun.color returns null for. parser field records the actual path.
        const hex = Bun.color(raw, "hex");
        if (hex) {
          const h = String(hex);
          const [r, g, b] = [
            parseInt(h.slice(1, 3), 16),
            parseInt(h.slice(3, 5), 16),
            parseInt(h.slice(5, 7), 16),
          ];
          return json(
            { ok: true, hex: h, rgb: [r, g, b], hsl: String(Bun.color(raw, "hsl")), parser: "bun.color" },
            200,
            designCorsHeaders(),
          );
        }
        const parsed = parseExtendedColor(raw);
        if (parsed) {
          const [r, g, b] = [
            parseInt(parsed.slice(1, 3), 16),
            parseInt(parsed.slice(3, 5), 16),
            parseInt(parsed.slice(5, 7), 16),
          ];
          return json(
            { ok: true, hex: parsed, rgb: [r, g, b], hsl: String(Bun.color(parsed, "hsl")), parser: "kernel" },
            200,
            designCorsHeaders(),
          );
        }
        return json({ ok: false, error: "unparseable color: " + raw.slice(0, 60) }, 422, designCorsHeaders());
      }

      if (url.pathname === "/api/color/theme") {
        return json(themeManifest(), 200, designCorsHeaders());
      }

      // Bundle health alone: live per-module sizes/budgets/largest-contributor
      // from the build metafiles + the trend history (same data as design:check).
      if (url.pathname === "/api/design/budgets") {
        return json({ generatedAt: new Date().toISOString(), modules: await buildBudgetHealth(ROOT) }, 200, designCorsHeaders());
      }

      // Token inspector page — the live consumer of /design-system.css.
      if (url.pathname === "/design") {
        return new Response(renderDesignPage(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...designCorsHeaders() },
        });
      }

      // Bundle trend dashboard — renders dist/bundle-history.json visually.
      if (url.pathname === "/design/trend") {
        const history = await readBundleHistory(bundleHistoryPath(ROOT));
        return new Response(renderTrendPage(history, new Date().toISOString()), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...designCorsHeaders() },
        });
      }

      // Design agent audit of the live HQ page (self-check)
      if (url.pathname === "/api/design/audit") {
        const hqAppDir = joinPath(ROOT, "src/research/hq-app");
        const surfaces = [
          renderHq(),
          ...(await Promise.all([
            Bun.file(joinPath(hqAppDir, "index.html")).text().catch(() => ""),
            Bun.file(joinPath(hqAppDir, "styles.css")).text().catch(() => ""),
            Bun.file(joinPath(hqAppDir, "app.js")).text().catch(() => ""),
            Bun.file(joinPath(hqAppDir, "color-vars.css")).text().catch(() => ""),
          ])),
        ];
        return json(designAgent.audit(...surfaces), 200, designCorsHeaders());
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

      // External webhook — not browser-facing, so no CSRF guard: the
      // double-submit pattern only protects browser-session POSTs.
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
        return csrfGuard(req, () => rateLimiter(req, () => handleAgentDispatch(req)));
      }

      if (url.pathname === "/ops/kalshi-rotate-key" && req.method === "POST") {
        return csrfGuard(req, () => rateLimiter(req, () => handleKalshiRotateKey(req)));
      }

      return new Response("Not Found", { status: 404 });
    },
  };
  // bun-types 1.3.x lag: inside `declare module "bun"`, the `Request` used by
  // Bun.serve's route/fetch signatures is the headers-only Bun.Request — it
  // lacks url/method even though the runtime passes a full DOM Request. Cast
  // the config once here instead of sprinkling casts through every handler.
  const server = Bun.serve(serveOptions as Bun.Serve.Options<undefined, string>);
  liveChannel.attachServer(server);
  // Hourly feed-refresh cron (once per process; unref'd). Tests create many
  // servers — the module-level guard prevents stacked jobs.
  registerFeedCron(() => ({}));
  // Daily blog-map tracker refresh (once per process; unref'd) — keeps the
  // mapping channel's state fresh without manual runs (§31).
  registerBlogMapCron(async () => {
    const m = await import("../lib/blog-map-run.ts");
    await m.runBlogMap({ root: ROOT });
  });
  // Wrap stop() so the memoryPressure listener (registered above) is
  // removed when the server stops — tests create many servers, and an
  // unremoved listener would accumulate across runs (recon finding, LOW).
  const origStop = server.stop.bind(server);
  (server as { stop?: () => void }).stop = () => {
    process.removeListener('memoryPressure', onMemoryPressure);
    return origStop(false);
  };

  // Signal pipeline self-refresh: a Bun.cron job re-collects signals into
  // the cache every 5 minutes (function form — event loop, no system cron;
  // unref'd so it never blocks exit; registered once per process so tests
  // creating many servers don't stack jobs).
  // Aggregate signal health into the /status shape (shared by the
  // /status endpoint + the cron broadcast over the live channel).
  const buildStatusPayload = (signals: Signal[]): StatusPayload => {
    const counts = { ok: 0, warn: 0, bad: 0, info: 0 };
    for (const s of signals) counts[s.severity] += 1;
    const ok = counts.bad === 0;
    return {
      type: "status-update",
      ok,
      status: ok ? "ok" : "degraded",
      signals: signals.length,
      channels: counts,
      failing: signals.filter((s) => s.severity === "bad").map((s) => ({ id: s.id, title: s.title })),
    };
  };

  const refreshSignalsCache = async (): Promise<void> => {
    signalsCache = {
      at: Date.now(),
      payload: await collectSignals(ROOT, {
        card: {
          hits: brandMetrics.card.hits,
          misses: brandMetrics.card.misses,
          errors: brandMetrics.card.errors,
          totalMs: brandMetrics.card.totalMs,
        },
        swatch: { served: brandMetrics.swatch.served },
        svg: { served: brandMetrics.svg.served },
        badge: { served: brandMetrics.badge.served },
        quote: { served: brandMetrics.quote.served },
        chart: { served: brandMetrics.chart.served },
        purges: brandMetrics.purges,
      }),
    };
    liveChannel.broadcastStatus(buildStatusPayload(signalsCache.payload));
  };
  registerSignalCron(refreshSignalsCache);

  return server;
}

if (import.meta.main) {
  const server = createResearchServer();
  console.log(`Research browser at ${server.url}`);
  // NOTE: startup card WARMING was removed — the boot-time WebView capture
  // crashed the process with an escaped "WebView closed" (async WebKit error
  // that bypasses try/catch). The /brand/card.png route warms the cache on
  // first request instead (probe: AGENT-PITFALLS §18).
}
