/**
 * Architecture schema — single source of truth for the Kalshi-bot codebase.
 *
 * Consumed by the /architecture UI page (architecture-view.ts) and
 * available for programmatic use (CI checks, agent context, docs gen).
 */
// ── Module Catalog ──────────────────────────────────────────────
export const MODULES = [
  {
    path: "src/research/",
    name: "Research Pipeline",
    purpose: "GitHub bot discovery: search → gate → inspect → score → report",
    entryPoints: ["cli.ts", "serve.ts", "scheduled.ts"],
    keyTypes: [
      "RepoCandidate", "InspectionSignals", "ScoreBreakdown",
      "ScoredRepo", "ResearchRun", "RunDiff",
    ],
    externalServices: ["GitHub (gh CLI)"],
  },
  {
    path: "src/bot/",
    name: "Kalshi API Client",
    purpose: "Signed REST + WebSocket client for Kalshi trade API",
    entryPoints: ["kalshi-client.ts", "kalshi-ws.ts", "kalshi-events-api.ts"],
    keyTypes: [
      "KalshiCredentials", "KalshiClient", "KalshiOrderRequest",
      "KalshiOrderResult", "KalshiWsHandlers",
    ],
    externalServices: ["Kalshi Trade API", "Kalshi WebSocket"],
  },
  {
    path: "src/alpha/",
    name: "Alpha Trading Engine",
    purpose: "Pinnacle odds feed → vig-strip → ticker mapping → edge computation → signal context",
    entryPoints: ["odds-feed.ts", "signal-context.ts", "ticker-mapper.ts", "run-shadow-once.ts"],
    keyTypes: [
      "FeedEventId", "OddsEvent", "PinnacleSnapshot",
      "MappedEvent", "SignalContext", "Decision",
    ],
    externalServices: ["The Odds API (Pinnacle)"],
  },
  {
    path: "src/institutions/event-store/",
    name: "Tennis Event Store",
    purpose: "ITF calendar → Kalshi market sync → orderbook recording → live scores",
    entryPoints: [
      "itf-calendar.ts", "kalshi-itf-sync.ts", "stadion-kalshi-bridge.ts",
      "orderbook-stream.ts", "live-scores.ts",
    ],
    keyTypes: [
      "CanonicalEventId", "MarketId", "CompetitorId", "MilestoneId",
      "KalshiMarketTicker", "KalshiEventTicker",
    ],
    externalServices: ["ITF Stadion API", "Kalshi Events API", "Kalshi WebSocket"],
  },
  {
    path: "src/institutions/",
    name: "Shared Institutions",
    purpose: "Cross-cutting types, ledger normalization, error codes, program manifest, resilient fetch, terminal utilities",
    entryPoints: [],
    keyTypes: [
      "NormalizedOrder", "NormalizedFill", "NormalizedPosition",
      "ProgramManifest", "CodedError", "EdgeBreakdown",
      "CircuitBreaker", "BookSnapshot", "SignalContext",
      "Decision",
    ],
    externalServices: [],
  },
  {
    path: "src/agent/",
    name: "Agent Orchestrator",
    purpose: "Meta-agent CLI dispatching research, tennis ground, pattern extraction, blueprint generation",
    entryPoints: ["cli.ts"],
    keyTypes: ["AgentCommand", "AgentReport", "ArchitectureBlueprint"],
    externalServices: [],
  },
  {
    path: "src/calibration/",
    name: "Calibration System",
    purpose: "Brier scoring, toxicity tracking, outcome resolution, graduation/kill proposals",
    entryPoints: ["watcher.ts", "toxicity-loop.ts", "resolve-outcomes.ts", "shadow-maintenance.ts"],
    keyTypes: ["ProgramMetrics", "CalibrationArtifact"],
    externalServices: [],
  },
  {
    path: "src/regulatory/",
    name: "Regulatory Compliance",
    purpose: "State-level bet blocking, rate limiting, Polymarket integration, agent team, audit trail",
    entryPoints: ["middleware/", "agents/", "integrations/polymarket.ts"],
    keyTypes: [
      "BetCheckParams", "BetCheckResult", "ComplianceContext",
      "PolymarketEvent", "PolymarketMarket",
    ],
    externalServices: ["Polymarket (Gamma API)"],
    errorClasses: [
      "BetBlockedError", "SelfExcludedError", "RateLimitError",
      "SteamAlertError", "WagerOutOfBoundsError", "LicenseError",
    ],
  },
  {
    path: "src/telegram/",
    name: "Telegram Bot",
    purpose: "Long-polling Telegram bot for status, dashboard, subscribe",
    entryPoints: ["bot.ts"],
    keyTypes: [],
    externalServices: ["Telegram Bot API"],
  },
  {
    path: "src/lib/",
    name: "Config Loader",
    purpose: "Load config.toml → zod validate → env override → deep-freeze",
    entryPoints: ["config.ts"],
    keyTypes: ["Config", "RawTomlConfig"],
    externalServices: [],
  },
  {
    path: "src/db/",
    name: "Drizzle ORM Schema",
    purpose: "16 SQLite table definitions for event store + regulatory + bet lifecycle",
    entryPoints: ["schema.ts"],
    keyTypes: [],
    externalServices: [],
  },
  {
    path: "src/protonpass/",
    name: "Proton Pass Integration",
    purpose: "Optional encrypted secret injection via Proton Pass CLI",
    entryPoints: [],
    keyTypes: [],
    externalServices: ["Proton Pass CLI"],
  },
  {
    path: "src/operations/",
    name: "Experiment Runner",
    purpose: "Factorial experiment designs and batch runners",
    entryPoints: [],
    keyTypes: [],
    externalServices: [],
  },
] as const;

// ── Entry Points ────────────────────────────────────────────────
export const ENTRY_POINTS = [
  { command: "bun run research", file: "src/research/cli.ts", purpose: "Full GitHub discovery pipeline" },
  { command: "bun run serve", file: "src/research/serve.ts", purpose: "HTTP dashboard (port 3456, --hot reload)" },
  { command: "bun run dev", file: "src/research/serve.ts", purpose: "HTTP dashboard with --watch (auto-restart on change)" },
  { command: "bun run test:watch", file: "bun test", purpose: "Test runner in watch mode" },
  { command: "bun run agent", file: "src/agent/cli.ts", purpose: "Meta-agent dispatcher" },
  { command: "bun run telegram", file: "src/telegram/bot.ts", purpose: "Telegram long-poll bot" },
  { command: "bun run alpha:run", file: "src/alpha/run-shadow-once.ts", purpose: "Single shadow trade execution" },
  { command: "bun run calibration:*", file: "src/calibration/", purpose: "Calibration watcher, toxicity, outcomes" },
  { command: "bun run regulatory:*", file: "src/regulatory/scripts/", purpose: "Admin, migration, sweep" },
  { command: "bun run db:*", file: "drizzle-kit", purpose: "Drizzle schema generation" },
] as const;

// ── External Services ───────────────────────────────────────────
export const EXTERNAL_SERVICES = [
  { name: "GitHub (gh CLI)", usedBy: ["src/research/"], auth: "OAuth token", purpose: "Repo + code search for Kalshi bots" },
  { name: "Kalshi Trade API", usedBy: ["src/bot/"], auth: "RSA-PSS signed headers", purpose: "Orders, portfolio, events (REST + WS)" },
  { name: "Kalshi WebSocket", usedBy: ["src/bot/", "src/institutions/event-store/"], auth: "RSA signed + session", purpose: "Orderbook delta streaming" },
  { name: "Pinnacle (The Odds API)", usedBy: ["src/alpha/"], auth: "API key", purpose: "Sports betting odds for edge computation" },
  { name: "ITF Stadion API", usedBy: ["src/institutions/event-store/"], auth: "None", purpose: "Tennis tournament calendar + results" },
  { name: "Telegram Bot API", usedBy: ["src/telegram/"], auth: "Bot token", purpose: "Notifications and commands" },
  { name: "Polymarket (Gamma API)", usedBy: ["src/regulatory/"], auth: "None", purpose: "Prediction market line movement detection" },
  { name: "Proton Pass CLI", usedBy: ["src/protonpass/"], auth: "Local session", purpose: "Optional encrypted secret injection" },
] as const;

// ── Data Flows ──────────────────────────────────────────────────
export const DATA_FLOWS = [
  {
    name: "Research Pipeline",
    description: "GitHub search → popularity gate → deep inspect → score → diversify → report",
    steps: [
      "discover.ts — gh search code/repos for Kalshi-related bots",
      "gate.ts — min stars/forks, max age filter",
      "inspect.ts — source analysis: auth patterns, SDK, order placement",
      "score.ts — multi-dimensional scoring (authApi, orderRealism, testsCi, etc.)",
      "diversify.ts — shortlist by tag/language diversity",
      "report.ts — markdown + JSONL audit exports",
    ],
    storage: ["cache.db (SQLite for API responses)", "research/outputs/ (reports)"],
  },
  {
    name: "Tennis Event Store",
    description: "ITF calendar → Kalshi market sync → bridge → orderbook → live scores",
    steps: [
      "itf-stadion.ts — fetch ITF tournament calendar via Stadion API",
      "kalshi-itf-sync.ts — poll Kalshi /markets for tennis series",
      "stadion-kalshi-bridge.ts — match ITF ↔ Kalshi events by day/team",
      "orderbook-stream.ts — WS + REST orderbook capture → book_ticks",
      "live-scores.ts — poll Kalshi /live_data → live_scores + score_snapshots",
    ],
    storage: ["event-store.db (SQLite: 8 tables, WAL mode)"],
  },
  {
    name: "Shadow Trading",
    description: "executeOnce → appendShadowLine → toxicity mark → outcome resolution → calibration",
    steps: [
      "execute.ts — read book_ticks → buildSignalContext → decide",
      "shadow.ts — append ShadowPredictionLine to shadow-log.jsonl",
      "toxicity-loop.ts — poll mids at 60s mark, append ToxicityMarkEntry",
      "resolve-outcomes.ts — append OutcomeResolutionEntry on event settlement",
      "watcher.ts — materialize → Brier score → graduation/kill proposals",
    ],
    storage: ["shadow-log.jsonl (append-only, hash-chained)"],
  },
] as const;

// ── Type System ─────────────────────────────────────────────────
export const TYPE_CATEGORIES = [
  {
    category: "Branded String IDs",
    description: "Zero-runtime-cost nominal types using `string & { readonly __brand: unique symbol }`",
    types: [
      { name: "FeedEventId", file: "src/alpha/odds-types.ts", purpose: "The Odds API event ID" },
      { name: "SignalEventId", file: "src/institutions/alpha-signal-types.ts", purpose: "Signal context event ID" },
      { name: "CanonicalEventId", file: "src/institutions/event-store/brands.ts", purpose: "Tennis match event ID" },
      { name: "MarketId", file: "src/institutions/event-store/brands.ts", purpose: "Kalshi venue market row" },
      { name: "CompetitorId", file: "src/institutions/event-store/brands.ts", purpose: "Tennis competitor UUID" },
      { name: "KalshiMarketTicker", file: "src/institutions/event-store/brands.ts", purpose: "Kalshi market ticker (e.g. KXNBAGAME-...)" },
      { name: "KalshiEventTicker", file: "src/institutions/event-store/brands.ts", purpose: "Kalshi event ticker" },
    ],
  },
  {
    category: "Wire → Normalized Types",
    description: "Snake_case wire types parsed at boundary → camelCase required fields internally",
    types: [
      { name: "NormalizedOrder", file: "src/institutions/ledger-types.ts", purpose: "Canonical order from KalshiOrderWire" },
      { name: "NormalizedFill", file: "src/institutions/ledger-types.ts", purpose: "Canonical fill record" },
      { name: "NormalizedPosition", file: "src/institutions/ledger-types.ts", purpose: "Canonical market position" },
      { name: "NormalizedBalance", file: "src/institutions/ledger-types.ts", purpose: "Canonical balance" },
    ],
  },
  {
    category: "Alpha Signal Types",
    description: "Odds feed → ticker mapping → signal decision pipeline",
    types: [
      { name: "OddsEvent / OddsMarket / OddsOutcome", file: "src/alpha/odds-types.ts", purpose: "The Odds API wire types" },
      { name: "PinnacleSnapshot", file: "src/alpha/odds-types.ts", purpose: "Vig-stripped Pinnacle consensus" },
      { name: "FeedEventRef / MappedEvent", file: "src/alpha/ticker-mapper.ts", purpose: "Ticker-to-event mapping" },
      { name: "BookLevel / BookSnapshot", file: "src/institutions/alpha-signal-types.ts", purpose: "Orderbook snapshot" },
      { name: "SignalContext", file: "src/institutions/alpha-signal-types.ts", purpose: "Complete trade signal" },
      { name: "Decision", file: "src/institutions/alpha-signal-types.ts", purpose: "Trade/skip decision" },
    ],
  },
  {
    category: "Error Types",
    description: "Three error conventions coexist across layers",
    types: [
      { name: "CodedError", file: "src/institutions/error-codes.ts", purpose: "Returned result-object { ok: false, code, error }" },
      { name: "RegulatoryError (15 subclasses)", file: "src/regulatory/lib/errors.ts", purpose: "Thrown typed errors (BetBlockedError, etc.)" },
      { name: "Error (bare)", file: "src/bot/kalshi-client.ts", purpose: "Plain throws in Kalshi client" },
    ],
  },
] as const;

// ── Error Convention Table ──────────────────────────────────────
export const ERROR_CONVENTIONS = [
  { layer: "Wire normalization (ledger-types.ts)", mechanism: "Silent null-coalescing (`?? null`)", thrownOrReturned: "Neither — best-effort normalization" },
  { layer: "Kalshi API client (kalshi-client.ts)", mechanism: "Throws bare Error", thrownOrReturned: "Throw" },
  { layer: "Research serve (error-codes.ts)", mechanism: "Returned CodedError with ok: false", thrownOrReturned: "Return (result-object)" },
  { layer: "Regulatory compliance (errors.ts)", mechanism: "Throws RegulatoryError subclass", thrownOrReturned: "Throw" },
  { layer: "Regulatory middleware", mechanism: "Returns plain Response with status code", thrownOrReturned: "Return (HTTP)" },
  { layer: "Resilient fetch (resilient-fetch.ts)", mechanism: "Returns Response for HTTP errors; throws for network/breaker", thrownOrReturned: "Mixed" },
] as const;

// ── Program Manifest Lifecycle ──────────────────────────────────
export const PROGRAM_LIFECYCLE = {
  statuses: ["shadow", "pilot", "live", "killed"] as const,
  promotion: "Proposal-only — watcher emits graduation-proposal / kill-recommendation artifacts; human changes program.json",
  gates: {
    graduation: [
      "spanWeeks ≥ shadowMinWeeks",
      "hash chain valid",
      "Brier ≤ baseline × (1 + killBrierDriftPct/100)",
      "fills ≥ graduationMinFills",
      "mean edge ≥ graduationMinRealizedEdgeCentsPerFill",
      "events ≥ graduationMinDistinctEvents",
      "not a baseline program (baselines never graduate)",
    ],
    kill: ["Brier > baseline × (1 + killBrierDriftPct/100)", "resolved lines ≥ shadowMinSignals"],
  },
  programs: [
    { name: "tennis-game-model", status: "shadow", role: "alpha", baseline: "none" },
    { name: "pinnacle-novig-mlb", status: "shadow", role: "baseline", baseline: "pinnacle-novig" },
    { name: "pinnacle-novig-nba", status: "shadow", role: "baseline", baseline: "pinnacle-novig" },
    { name: "tennis-tour-pinnacle-novig", status: "shadow", role: "baseline", baseline: "self" },
  ],
} as const;

// ── Cron Schedule ───────────────────────────────────────────────
export const CRON_JOBS = [
  { name: "Research pipeline", schedule: "0 6 * * MON", entrypoint: "src/research/scheduled.ts", purpose: "Weekly GitHub discovery" },
  { name: "Tennis live canary", schedule: "*/15 * * * *", entrypoint: "tools/tennis/live-canary-scheduled.ts", purpose: "Dry-run live_data poll" },
  { name: "Tennis WS recorder", schedule: "*/30 * * * *", entrypoint: "tools/tennis/ws-recorder-scheduled.ts", purpose: "Orderbook capture → book_ticks" },
  { name: "Tennis factorial experiment", schedule: "0 9 * * *", entrypoint: "tools/tennis/experiment-scheduled.ts", purpose: "DailyCheckAll → experiment JSON" },
  { name: "Match liquidity pipeline", schedule: "*/30 * * * *", entrypoint: "tools/match-liquidity-scheduled.ts", purpose: "recompute + volume backfill + ground + snapshot" },
] as const;

// ── Aggregate Stats ─────────────────────────────────────────────
export const ARCHITECTURE_STATS = {
  totalSourceFiles: "~230 .ts files (excluding node_modules, fixtures)",
  totalTypes: "~100+ exported types, interfaces, brands",
  totalEntryPoints: ENTRY_POINTS.length,
  totalModules: MODULES.length,
  totalExternalServices: EXTERNAL_SERVICES.length,
  totalTables: 16, // Drizzle ORM
  totalAlphaPrograms: PROGRAM_LIFECYCLE.programs.length,
  totalTests: "778+ across 121 test files",
  runtime: "Bun ≥1.3.13 (zero npm deps except drizzle-orm + zod)",
  dbEngines: ["SQLite (bun:sqlite) — event store, cache, regulatory DB"],
} as const;
