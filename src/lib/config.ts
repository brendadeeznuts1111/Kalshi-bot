/**
 * src/lib/config.ts — Global runtime configuration loader.
 *
 * Loads config.toml via Bun.TOML, validates with zod, applies
 * KALSHI__SECTION__SUBSECTION__KEY env overrides, and deep-freezes
 * the result. Any section may be omitted; schema defaults fill gaps.
 *
 * Environment (Bun-native — no dotenv):
 *   Auto-load order: .env → .env.{NODE_ENV} → .env.local (increasing precedence)
 *   Read via Bun.env (alias of process.env / import.meta.env)
 *   Override files: bun --env-file=.env.1 · disable: --no-env-file · bunfig `env = false`
 *
 *   import { config, loadConfig } from "./src/lib/config.ts";
 *
 * @see https://bun.com/docs/runtime/environment-variables
 * @see https://bun.com/docs/runtime/utils#bun-env
 * @see https://bun.com/docs/api/toml
 */

import { readFileSync } from "node:fs";
import { z } from "zod";

// ── Typed env interface (autocompletion + compile-time catch) ──
// Interface merging: keys become typed on Bun.env / process.env
// @see https://bun.com/docs/runtime/environment-variables#typescript
declare module "bun" {
  interface Env {
    // ── API credentials ──
    /** Kalshi API key ID for REST + WebSocket auth */
    KALSHI_API_KEY_ID?: string;
    /** Inline PEM private key for Kalshi auth */
    KALSHI_PRIVATE_KEY?: string;
    /** Path to PEM file for Kalshi auth */
    KALSHI_PRIVATE_KEY_PATH?: string;
    /** Legacy key alias (prefer KALSHI_API_KEY_ID) */
    KALSHI_ACCESS_KEY?: string;
    /** Kalshi API base URL override */
    KALSHI_API_BASE?: string;
    /** The Odds API key for Pinnacle consensus feed */
    ODDS_API_KEY?: string;
    /** GitHub token for rate-limit checks and research pipeline */
    GITHUB_TOKEN?: string;
    /** Alias preferred by `gh` / some scripts (same as GITHUB_TOKEN) */
    GH_TOKEN?: string;

    // ── Environment gates ──
    /** Kalshi client environment: demo (default) or prod */
    KALSHI_ENV?: string;
    /** Must be "1" to enable live trading when KALSHI_ALPHA_LIVE is set */
    KALSHI_PROD_ARMED?: string;
    /** Independent fail-closed breaker for authorized partner order execution */
    KALSHI_AUTHORIZED_EXECUTION_ENABLED?: string;
    /** Alpha live trading flag (prefer KALSHI_ALPHA_LIVE) */
    ALPHA_LIVE?: string;
    /** Alpha live trading flag */
    KALSHI_ALPHA_LIVE?: string;
    /** Node environment: development | production | test */
    NODE_ENV?: string;

    // ── Server & networking ──
    /** Listen port (Bun.serve also honors BUN_PORT / --port) */
    PORT?: string;
    /** Bun.serve port (built-in, also reads --port, PORT, NODE_PORT) */
    BUN_PORT?: string;
    /** Bind hostname for research server patterns / docs */
    SERVE_HOST?: string;
    /** Public URL of the ops dashboard for alert links (prefer OPS_DASHBOARD_URL) */
    SERVE_URL?: string;
    /** Public URL of the ops dashboard for alert links */
    OPS_DASHBOARD_URL?: string;
    /** Regulatory service compliance URL (prefer REGULATORY_COMPLIANCE_URL) */
    COMPLIANCE_URL?: string;
    /** Regulatory service compliance URL */
    REGULATORY_COMPLIANCE_URL?: string;
    /** GitHub rate-limit wait mode ("1" = block until budget available) */
    GITHUB_RATE_LIMIT_WAIT?: string;

    // ── Telegram bot & alerts ──
    /** Telegram Bot API token */
    TELEGRAM_BOT_TOKEN?: string;
    /** Telegram channel/group chat ID for alerts */
    TELEGRAM_ALERT_CHAT_ID?: string;
    /** Telegram forum thread ID for alerts */
    TELEGRAM_ALERT_THREAD_ID?: string;
    /** Discord/Slack webhook URL for alerts */
    ALERT_WEBHOOK_URL?: string;
    /** Set to "1" to create forum topics during setup */
    TELEGRAM_SETUP_TOPICS?: string;

    // ── Research pipeline ──
    /** Dimension override for research runs */
    RESEARCH_DIMENSION?: string;
    /** Set to "1" to export audit after research */
    RESEARCH_EXPORT_AUDIT?: string;
    /** Set to "1" to skip GitHub rate-limit preflight */
    RESEARCH_SKIP_RATE_PREFLIGHT?: string;
    /** Cron schedule for research (e.g. "0 6 * * MON") */
    RESEARCH_CRON_SCHEDULE?: string;
    /** Cron title for OS-level registration */
    RESEARCH_CRON_TITLE?: string;
    /** Set to "1" to enable broad discovery sweep */
    RESEARCH_DISCOVER_BROAD?: string;
    /** Override research cache DB path */
    RESEARCH_CACHE_DB?: string;
    /** Discovery shortlist size */
    RESEARCH_SHORTLIST?: string;
    /** Min stars gate */
    RESEARCH_MIN_STARS?: string;
    /** Min forks gate */
    RESEARCH_MIN_FORKS?: string;
    /** Max repo age months gate */
    RESEARCH_MAX_AGE_MONTHS?: string;
    /** Root directory for repo clones (prefer RESEARCH_REPO_CLONE_ROOT) */
    REPO_CLONE_ROOT?: string;
    /** Root directory for repo clones */
    RESEARCH_REPO_CLONE_ROOT?: string;
    /** Home override for kalshi key rotate journal/files */
    KALSHI_ROTATE_HOME?: string;

    // ── Calibration & toxicity ──
    /** Toxicity sweep cron schedule */
    TOXICITY_CRON_SCHEDULE?: string;
    /** Toxicity sweep cron title */
    TOXICITY_CRON_TITLE?: string;

    // ── Tennis pipeline ──
    /** Live poll interval in ms */
    TENNIS_LIVE_INTERVAL_MS?: string;
    /** Live poll concurrency */
    TENNIS_LIVE_CONCURRENCY?: string;
    /** Recording interval in ms */
    TENNIS_RECORD_INTERVAL_MS?: string;
    /** WS recorder session duration in seconds */
    TENNIS_WS_RECORDER_WS_SECONDS?: string;
    /** WS recorder cron schedule */
    TENNIS_WS_RECORDER_CRON_SCHEDULE?: string;
    /** WS recorder cron title */
    TENNIS_WS_RECORDER_CRON_TITLE?: string;
    /** Live canary cron schedule */
    TENNIS_LIVE_CANARY_CRON_SCHEDULE?: string;
    /** Live canary cron title */
    TENNIS_LIVE_CANARY_CRON_TITLE?: string;
    /** Experiment cron schedule */
    TENNIS_EXPERIMENT_CRON_SCHEDULE?: string;
    /** Experiment cron title */
    TENNIS_EXPERIMENT_CRON_TITLE?: string;

    // ── ProtonPass secrets ──
    /** ProtonPass key provider */
    PROTON_PASS_KEY_PROVIDER?: string;
    /** ProtonPass personal access token */
    PROTON_PASS_PERSONAL_ACCESS_TOKEN?: string;
    /** ProtonPass session directory */
    PROTON_PASS_SESSION_DIR?: string;

    // ── Storage ──
    /** Regulatory database path (prefer REGULATORY_DATABASE_PATH) */
    REGULATORY_DB?: string;
    /** Regulatory database path */
    REGULATORY_DATABASE_PATH?: string;

    /**
     * Bun runtime knobs — Configuring Bun table.
     * @see https://bun.com/docs/runtime/environment-variables#configuring-bun
     */
    /** Disable TLS cert validation (testing only) */
    NODE_TLS_REJECT_UNAUTHORIZED?: string;
    /** Log fetch as curl (`curl`) or headers-only (`1`) */
    BUN_CONFIG_VERBOSE_FETCH?: string;
    /** Transpiler cache dir (`0` / `""` disables; Docker images disable by default) */
    BUN_RUNTIME_TRANSPILER_CACHE_PATH?: string;
    /** Max concurrent HTTP (fetch + bun install); default 256 */
    BUN_CONFIG_MAX_HTTP_REQUESTS?: string;
    /** bun --watch: do not clear console on reload */
    BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD?: string;
    /** Intermediate assets during bundling */
    TMPDIR?: string;
    /** Disable ANSI (`NO_COLOR=1`) — also dims Bun.color("…","ansi") */
    NO_COLOR?: string;
    /** Force ANSI even if NO_COLOR set */
    FORCE_COLOR?: string;
    /** Prepend CLI args to every bun run (e.g. `--hot`) */
    BUN_OPTIONS?: string;
    /** Disable crash report uploads + telemetry */
    DO_NOT_TRACK?: string;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Zod schema (kebab-case keys, mirroring config.toml)
// ═════════════════════════════════════════════════════════════════════════════

const LogLevel = z.enum(["debug", "info", "warn", "error"]);

const MetaSchema = z.object({
  name: z.string().min(1).default("kalshi-bot-research"),
  version: z.string().min(1).default("0.2.0"),
  environment: z.enum(["development", "staging", "production"]).default("development"),
});

const RateLimiterSchema = z.object({
  "window-ms": z.number().int().positive().default(60_000),
  "max-requests": z.number().int().positive().default(100),
  "fallback-ip": z.string().min(1).default("unknown"),
});

const AlertsSchema = z.object({
  "violation-window-seconds": z.number().int().positive().default(300),
  "violation-threshold": z.number().int().positive().default(10),
  "summary-minutes": z.number().int().positive().default(60),
  "top-reasons-limit": z.number().int().positive().default(5),
  "top-states-limit": z.number().int().positive().default(5),
  "recent-limit": z.number().int().positive().default(20),
});

const PolymarketSchema = z.object({
  "delta-bp-threshold": z.number().int().positive().default(500),
  "min-volume-24hr": z.number().positive().default(1_000),
  "tracking-window-seconds": z.number().int().positive().default(300),
  "max-spread": z.number().positive().max(1).default(0.05),
  "fetch-limit": z.number().int().positive().default(50),
  "steam-lookback-seconds": z.number().int().positive().default(60),
});

const MigrationSchema = z.object({
  "retention-days": z.number().int().positive().default(90),
  "migrations-dir": z.string().min(1).default("db/migrations"),
});

const RegulatorySchema = z.object({
  "database-path": z.string().default("./data/regulatory.db"),
  "default-country-code": z.string().length(2).default("US"),
  "default-user-id": z.string().min(1).default("anonymous"),
  "rate-limiter": RateLimiterSchema.prefault({}),
  alerts: AlertsSchema.prefault({}),
  polymarket: PolymarketSchema.prefault({}),
  migration: MigrationSchema.prefault({}),
});

const ServerSchema = z.object({
  port: z.number().int().positive().max(65_535).default(7_100),
  host: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$|^localhost$/).default("0.0.0.0"),
});

const LoggingSchema = z.object({
  level: LogLevel.default("info"),
  "colors-enabled": z.boolean().default(true),
});

const PipelineAlertsSchema = z.object({
  "debounce-ms": z.number().int().positive().default(300_000),
  "staleness-threshold-ms": z.number().int().positive().default(120_000),
  "poly-dropout-pct": z.number().min(0).max(100).default(30),
  "poly-dropout-ticks": z.number().int().min(1).default(3),
  "volume-gap-count": z.number().int().min(1).default(10),
  "volume-gap-ticks": z.number().int().min(1).default(3),
  "feed-frozen-ticks": z.number().int().min(1).default(6),
  "divergence-cents": z.number().int().positive().default(15),
  "rolling-buffer-size": z.number().int().min(2).max(20).default(5),
});

/** Root TOML schema — any section can be omitted; defaults fill gaps. */
const TomlSchema = z.object({
  meta: MetaSchema.prefault({}),
  regulatory: RegulatorySchema.prefault({}),
  server: ServerSchema.prefault({}),
  logging: LoggingSchema.prefault({}),
  "pipeline-alerts": PipelineAlertsSchema.prefault({}),
});

// ═════════════════════════════════════════════════════════════════════════════
//  Type inference from Zod schema
// ═════════════════════════════════════════════════════════════════════════════

/** Raw TOML output (kebab-case keys). */
export type RawTomlConfig = z.infer<typeof TomlSchema>;

/** Canonical camelCase config exported to consumers. */
export interface Config {
  meta: {
    name: string;
    version: string;
    environment: "development" | "staging" | "production";
  };
  regulatory: {
    databasePath: string;
    defaultCountryCode: string;
    defaultUserId: string;
    rateLimiter: {
      windowMs: number;
      maxRequests: number;
      fallbackIp: string;
    };
    alerts: {
      violationWindowSeconds: number;
      violationThreshold: number;
      summaryMinutes: number;
      topReasonsLimit: number;
      topStatesLimit: number;
      recentLimit: number;
    };
    polymarket: {
      deltaBpThreshold: number;
      minVolume24hr: number;
      trackingWindowSeconds: number;
      maxSpread: number;
      fetchLimit: number;
      steamLookbackSeconds: number;
    };
    migration: {
      retentionDays: number;
      migrationsDir: string;
    };
  };
  server: {
    port: number;
    host: string;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    colorsEnabled: boolean;
  };
  pipelineAlerts: {
    debounceMs: number;
    stalenessThresholdMs: number;
    polyDropoutPct: number;
    polyDropoutTicks: number;
    volumeGapCount: number;
    volumeGapTicks: number;
    feedFrozenTicks: number;
    divergenceCents: number;
    rollingBufferSize: number;
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Helpers
// ═════════════════════════════════════════════════════════════════════════════

/** kebab-case / snake_case → camelCase. */
function toCamelCase(kebab: string): string {
  return kebab.replace(/[-_]([a-z])/g, (_, letter) => letter.toUpperCase());
}

function deepFreeze<T extends object>(obj: T): T {
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value !== null && typeof value === "object") {
      deepFreeze(value as Record<string, unknown>);
    }
  }
  return Object.freeze(obj) as T;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = obj;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (next === null || typeof next !== "object") return;
    cursor = next as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1];
  if (leaf in cursor) cursor[leaf] = value;
}

/** Coerce env string → number/boolean when it looks like one. */
function coerceValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (raw.trim() !== "" && Number.isFinite(n)) return n;
  return raw;
}

/** Apply KALSHI__SECTION__SUBSECTION__KEY overrides from Bun.env. */
function applyEnvOverrides(config: Config): void {
  const prefix = "KALSHI__";
  // Bun.env ≡ process.env ≡ import.meta.env
  for (const [key, value] of Object.entries(Bun.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;
    const path = key
      .slice(prefix.length)
      .split("__")
      .map((part) => toCamelCase(part.toLowerCase()))
      .join(".");
    setPath(config as unknown as Record<string, unknown>, path, coerceValue(value));
  }
}

/** Normalize validated raw TOML into canonical camelCase Config. */
function normalize(raw: RawTomlConfig): Config {
  const r = raw.regulatory;
  const rl = r["rate-limiter"];

  return {
    meta: {
      name: raw.meta.name,
      version: raw.meta.version,
      environment: raw.meta.environment,
    },
    regulatory: {
      databasePath: r["database-path"],
      defaultCountryCode: r["default-country-code"],
      defaultUserId: r["default-user-id"],
      rateLimiter: {
        windowMs: rl["window-ms"],
        maxRequests: rl["max-requests"],
        fallbackIp: rl["fallback-ip"],
      },
      alerts: {
        violationWindowSeconds: r.alerts["violation-window-seconds"],
        violationThreshold: r.alerts["violation-threshold"],
        summaryMinutes: r.alerts["summary-minutes"],
        topReasonsLimit: r.alerts["top-reasons-limit"],
        topStatesLimit: r.alerts["top-states-limit"],
        recentLimit: r.alerts["recent-limit"],
      },
      polymarket: {
        deltaBpThreshold: r.polymarket["delta-bp-threshold"],
        minVolume24hr: r.polymarket["min-volume-24hr"],
        trackingWindowSeconds: r.polymarket["tracking-window-seconds"],
        maxSpread: r.polymarket["max-spread"],
        fetchLimit: r.polymarket["fetch-limit"],
        steamLookbackSeconds: r.polymarket["steam-lookback-seconds"],
      },
      migration: {
        retentionDays: r.migration["retention-days"],
        migrationsDir: r.migration["migrations-dir"],
      },
    },
    server: {
      port: raw.server.port,
      host: raw.server.host,
    },
    logging: {
      level: raw.logging.level,
      colorsEnabled: raw.logging["colors-enabled"],
    },
    pipelineAlerts: {
      debounceMs: raw["pipeline-alerts"]["debounce-ms"],
      stalenessThresholdMs: raw["pipeline-alerts"]["staleness-threshold-ms"],
      polyDropoutPct: raw["pipeline-alerts"]["poly-dropout-pct"],
      polyDropoutTicks: raw["pipeline-alerts"]["poly-dropout-ticks"],
      volumeGapCount: raw["pipeline-alerts"]["volume-gap-count"],
      volumeGapTicks: raw["pipeline-alerts"]["volume-gap-ticks"],
      feedFrozenTicks: raw["pipeline-alerts"]["feed-frozen-ticks"],
      divergenceCents: raw["pipeline-alerts"]["divergence-cents"],
      rollingBufferSize: raw["pipeline-alerts"]["rolling-buffer-size"],
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Loader
// ═════════════════════════════════════════════════════════════════════════════

export function loadConfig(configPath = "config.toml"): Config {
  let raw: RawTomlConfig;

  try {
    let text = readFileSync(configPath, "utf-8");
    // Interpolate $VAR and ${VAR} (mirrors .env expansion; Bun already expands .env itself)
    text = text.replace(/\$(\w+|\{[^}]*\})/g, (match, name) => {
      const key = name.replace(/[{}]/g, "");
      const val = Bun.env[key];
      if (val === undefined) {
        console.warn(`[config] Env var \$${key} referenced in ${configPath} but not set — leaving as-is`);
        return match;
      }
      return val;
    });
    const parsed = Bun.TOML.parse(text) as unknown;
    const validated = TomlSchema.safeParse(parsed);

    if (!validated.success) {
      console.error(`[config] Validation failed for ${configPath}:`);
      for (const issue of validated.error.issues) {
        console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
      }
      console.warn("[config] Falling back to default configuration.");
      raw = TomlSchema.parse({});
    } else {
      raw = validated.data;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[config] Could not load ${configPath} — ${msg}. Using defaults.`);
    raw = TomlSchema.parse({});
  }

  const config = normalize(raw);
  applyEnvOverrides(config);
  return deepFreeze(config);
}

/** Deep-frozen runtime configuration. */
export const config = loadConfig();
