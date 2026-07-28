/**
 * src/lib/config.ts — Global runtime configuration loader.
 *
 * Loads config.toml via Bun.TOML, validates with zod, applies
 * KALSHI__SECTION__SUBSECTION__KEY env overrides, and deep-freezes
 * the result. Any section may be omitted; schema defaults fill gaps.
 *
 *   import { config, loadConfig } from "./src/lib/config.ts";
 */

import { readFileSync } from "node:fs";
import { z } from "zod";

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

/** Root TOML schema — any section can be omitted; defaults fill gaps. */
const TomlSchema = z.object({
  meta: MetaSchema.prefault({}),
  regulatory: RegulatorySchema.prefault({}),
  server: ServerSchema.prefault({}),
  logging: LoggingSchema.prefault({}),
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

/** Apply KALSHI__SECTION__SUBSECTION__KEY overrides from process.env. */
function applyEnvOverrides(config: Config): void {
  const prefix = "KALSHI__";
  for (const [key, value] of Object.entries(process.env)) {
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
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Loader
// ═════════════════════════════════════════════════════════════════════════════

export function loadConfig(configPath = "config.toml"): Config {
  let raw: RawTomlConfig;

  try {
    const text = readFileSync(configPath, "utf-8");
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
