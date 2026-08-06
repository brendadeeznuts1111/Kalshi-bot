export const EXECUTION_RISK_CODES = [
  "CONFIG_MISSING",
  "EXECUTION_DISABLED",
  "GLOBAL_KILL_SWITCH",
  "OUT_KILL_SWITCH",
  "PROD_NOT_ARMED",
  "PROVIDER_SESSION_UNHEALTHY",
  "PROVIDER_UNHEALTHY",
  "PERSISTENT_PROVIDER_ERRORS",
  "BOOK_STALE",
  "UNKNOWN_BACKLOG_COUNT",
  "UNKNOWN_BACKLOG_AGE",
  "STALE_PLACING_BACKLOG",
  "BALANCE_EXPOSURE_DRIFT",
  "MIGRATION_UNHEALTHY",
  "MAINTENANCE_STALE",
  "TELEMETRY_STALE",
] as const;

export type ExecutionRiskCode = (typeof EXECUTION_RISK_CODES)[number];
export type ExecutionEnvironment = "demo" | "prod";

export interface ExecutionRiskThresholds {
  maxUnknownCount: number;
  maxPersistentProviderErrors: number;
  maxUnknownAgeMs: number;
  maxStalePlacingCount: number;
  maxBalanceExposureDriftCents: number;
  maxMaintenanceAgeMs: number;
  maxTelemetryAgeMs: number;
}

export const DEFAULT_EXECUTION_RISK_THRESHOLDS: ExecutionRiskThresholds = {
  maxUnknownCount: 0,
  maxPersistentProviderErrors: 0,
  maxUnknownAgeMs: 2 * 60_000,
  maxStalePlacingCount: 0,
  maxBalanceExposureDriftCents: 0,
  maxMaintenanceAgeMs: 2 * 60_000,
  maxTelemetryAgeMs: 2 * 60_000,
};

export interface ExecutionRiskSignals {
  providerSessionHealthy: boolean | null;
  providerHealthy: boolean | null;
  /** Global count of unresolved rows with at least three provider lookup errors. */
  persistentProviderErrorCount: number | null;
  bookFresh: boolean | null;
  unknownCount: number | null;
  oldestUnknownAgeMs: number | null;
  stalePlacingCount: number | null;
  oldestStalePlacingAgeMs: number | null;
  /** Absolute, independently measured provider-vs-local discrepancy. */
  balanceExposureDriftCents: number | null;
  migrationHealthy: boolean | null;
  maintenanceAgeMs: number | null;
  telemetryAgeMs: number | null;
}

export interface ExecutionRiskHealthInput extends ExecutionRiskSignals {
  environment: ExecutionEnvironment | null;
  executionEnabled: boolean;
  prodArmed: boolean;
  globalKillSwitch: boolean;
  outKillSwitch: boolean;
  thresholds: ExecutionRiskThresholds;
}

export interface ExecutionRiskFinding {
  code: ExecutionRiskCode;
  reason: string;
}

export interface ExecutionRiskHealthDecision {
  healthy: boolean;
  codes: ExecutionRiskCode[];
  findings: ExecutionRiskFinding[];
}

/** Pure, deterministic, fail-closed live-execution health decision. */
export function evaluateExecutionRiskHealth(
  input: ExecutionRiskHealthInput,
): ExecutionRiskHealthDecision {
  validateThresholds(input.thresholds);
  const findings: ExecutionRiskFinding[] = [];
  const deny = (code: ExecutionRiskCode, reason: string) => findings.push({ code, reason });

  if (input.environment === null) deny("CONFIG_MISSING", "KALSHI_ENV must be demo or prod");
  if (!input.executionEnabled) deny("EXECUTION_DISABLED", "authorized execution is not enabled");
  if (input.globalKillSwitch) deny("GLOBAL_KILL_SWITCH", "global execution kill switch is active");
  if (input.outKillSwitch) deny("OUT_KILL_SWITCH", "execution out kill switch is active");
  if (input.environment === "prod" && !input.prodArmed) {
    deny("PROD_NOT_ARMED", "production execution is not armed");
  }

  requiredBoolean(input.providerSessionHealthy, "provider session health", deny, "PROVIDER_SESSION_UNHEALTHY");
  requiredBoolean(input.providerHealthy, "provider health", deny, "PROVIDER_UNHEALTHY");
  const persistentErrors = requiredNonNegativeInteger(
    input.persistentProviderErrorCount,
    "persistent provider error count",
    deny,
  );
  if (persistentErrors !== null &&
      persistentErrors > input.thresholds.maxPersistentProviderErrors) {
    deny(
      "PERSISTENT_PROVIDER_ERRORS",
      `persistent provider error count ${persistentErrors} exceeds ${input.thresholds.maxPersistentProviderErrors}`,
    );
  }
  requiredBoolean(input.bookFresh, "executable book freshness", deny, "BOOK_STALE");
  requiredBoolean(input.migrationHealthy, "execution migration health", deny, "MIGRATION_UNHEALTHY");

  const unknownCount = requiredNonNegativeInteger(input.unknownCount, "unknown reservation count", deny);
  if (unknownCount !== null && unknownCount > input.thresholds.maxUnknownCount) {
    deny("UNKNOWN_BACKLOG_COUNT", `unknown reservation count ${unknownCount} exceeds ${input.thresholds.maxUnknownCount}`);
  }
  if (unknownCount !== null && unknownCount > 0) {
    const age = requiredNonNegativeInteger(input.oldestUnknownAgeMs, "oldest unknown age", deny);
    if (age !== null && age > input.thresholds.maxUnknownAgeMs) {
      deny("UNKNOWN_BACKLOG_AGE", `oldest unknown age ${age}ms exceeds ${input.thresholds.maxUnknownAgeMs}ms`);
    }
  }

  const stalePlacingCount = requiredNonNegativeInteger(
    input.stalePlacingCount,
    "stale placing count",
    deny,
  );
  if (stalePlacingCount !== null && stalePlacingCount > input.thresholds.maxStalePlacingCount) {
    deny(
      "STALE_PLACING_BACKLOG",
      `stale placing count ${stalePlacingCount} exceeds ${input.thresholds.maxStalePlacingCount}`,
    );
  }
  if (stalePlacingCount !== null && stalePlacingCount > 0) {
    requiredNonNegativeInteger(input.oldestStalePlacingAgeMs, "oldest stale placing age", deny);
  }

  const drift = requiredNonNegativeInteger(
    input.balanceExposureDriftCents,
    "balance exposure drift",
    deny,
  );
  if (drift !== null && drift > input.thresholds.maxBalanceExposureDriftCents) {
    deny(
      "BALANCE_EXPOSURE_DRIFT",
      `balance exposure drift ${drift} cents exceeds ${input.thresholds.maxBalanceExposureDriftCents}`,
    );
  }
  checkAge(input.maintenanceAgeMs, "maintenance", input.thresholds.maxMaintenanceAgeMs, "MAINTENANCE_STALE", deny);
  checkAge(input.telemetryAgeMs, "telemetry", input.thresholds.maxTelemetryAgeMs, "TELEMETRY_STALE", deny);

  return {
    healthy: findings.length === 0,
    codes: [...new Set(findings.map((finding) => finding.code))],
    findings,
  };
}

export interface LoadExecutionRiskHealthInput {
  env?: Record<string, string | undefined>;
  /** Canonical out prefix, for example KALSHI_SPORTS_1_. */
  outEnvPrefix: string;
  signals: ExecutionRiskSignals;
  thresholds?: Partial<ExecutionRiskThresholds>;
}

/** Load only explicit runtime authority; absent health signals remain fail-closed. */
export function loadExecutionRiskHealthInput(
  options: LoadExecutionRiskHealthInput,
): ExecutionRiskHealthInput {
  const env = options.env ?? (Bun.env as Record<string, string | undefined>);
  const environment = env.KALSHI_ENV === "demo" || env.KALSHI_ENV === "prod"
    ? env.KALSHI_ENV
    : null;
  const prefix = normalizeOutPrefix(options.outEnvPrefix);
  return {
    ...options.signals,
    environment,
    executionEnabled: env.KALSHI_AUTHORIZED_EXECUTION_ENABLED === "1",
    prodArmed: env.KALSHI_PROD_ARMED === "1",
    globalKillSwitch: env.KALSHI_EXECUTION_KILL_SWITCH === "1",
    outKillSwitch: env[`${prefix}EXECUTION_KILL_SWITCH`] === "1",
    thresholds: { ...DEFAULT_EXECUTION_RISK_THRESHOLDS, ...options.thresholds },
  };
}

export function loadAndEvaluateExecutionRiskHealth(
  options: LoadExecutionRiskHealthInput,
): ExecutionRiskHealthDecision {
  return evaluateExecutionRiskHealth(loadExecutionRiskHealthInput(options));
}

/** Build fail-closed risk evidence from the execution store plus explicit
 * provider/telemetry signals. Missing external evidence stays null. */
export function evaluateStoredExecutionRiskHealth(options: {
  db: Database;
  outId: string;
  ticker: string;
  outEnvPrefix: string;
  env?: Record<string, string | undefined>;
  nowMs?: number;
  bookMaxAgeMs?: number;
  placingStaleAfterMs?: number;
}): ExecutionRiskHealthDecision {
  const nowMs = options.nowMs ?? Date.now();
  const env = options.env ?? (Bun.env as Record<string, string | undefined>);
  const prefix = normalizeOutPrefix(options.outEnvPrefix);
  const backlog = options.db.query(
    `SELECT
       SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) AS unknownCount,
       MIN(CASE WHEN status = 'unknown' THEN updated_at_ms END) AS oldestUnknownAtMs,
       SUM(CASE WHEN status = 'placing' AND updated_at_ms <= $placingCutoff THEN 1 ELSE 0 END)
         AS stalePlacingCount,
       MIN(CASE WHEN status = 'placing' AND updated_at_ms <= $placingCutoff
         THEN updated_at_ms END) AS oldestStalePlacingAtMs
     FROM exposure_reservations WHERE out_id = $outId`,
  ).get({
    $outId: options.outId,
    $placingCutoff: nowMs - (options.placingStaleAfterMs ?? 60_000),
  }) as {
    unknownCount: number | null; oldestUnknownAtMs: number | null;
    stalePlacingCount: number | null; oldestStalePlacingAtMs: number | null;
  };
  const globalProviderErrors = options.db.query(
    `SELECT COUNT(*) AS count FROM exposure_reservations
     WHERE status = 'unknown' AND reconciliation_result = 'error'
       AND reconciliation_attempts >= 3`,
  ).get() as { count: number };
  let book: { observedAtMs: number } | null = null;
  try {
    book = options.db.query(
      `SELECT COALESCE(recv_ts, ts) AS observedAtMs FROM book_ticks
       WHERE ticker = $ticker ORDER BY COALESCE(recv_ts, ts) DESC, id DESC LIMIT 1`,
    ).get({ $ticker: options.ticker }) as { observedAtMs: number } | null;
  } catch {
    // Missing/migrating telemetry is represented as unavailable evidence.
  }
  const migration = options.db.query(
    `SELECT 1 AS ok FROM _partner_execution_migrations WHERE id = $id`,
  ).get({ $id: EXECUTION_MIGRATIONS.at(-1)?.id ?? "" }) as { ok: number } | null;
  const maintenanceAt = env[`${prefix}MAINTENANCE_AT_MS`];
  const telemetryAt = env[`${prefix}TELEMETRY_AT_MS`];
  let storedDrift: { cashDriftMinor: number; positionDriftContracts: number } | null = null;
  try {
    storedDrift = options.db.query(
      `SELECT ABS(cash_drift_minor) AS cashDriftMinor,
              position_drift_contracts AS positionDriftContracts
         FROM provider_accounting_observations
        WHERE provider = 'kalshi' AND out_id = $outId
        ORDER BY observed_at_ms DESC, id DESC LIMIT 1`,
    ).get({ $outId: options.outId }) as {
      cashDriftMinor: number;
      positionDriftContracts: number;
    } | null;
  } catch {
    // An absent observation table is unavailable evidence and fails closed below.
  }
  const configuredDrift = integerEnv(env[`${prefix}BALANCE_EXPOSURE_DRIFT_CENTS`]);
  const effectiveDrift = storedDrift === null
    ? configuredDrift
    : Math.max(storedDrift.cashDriftMinor, storedDrift.positionDriftContracts > 0
      ? DEFAULT_EXECUTION_RISK_THRESHOLDS.maxBalanceExposureDriftCents + 1
      : 0);
  return loadAndEvaluateExecutionRiskHealth({
    env,
    outEnvPrefix: prefix,
    signals: {
      providerSessionHealthy: explicitHealthy(env[`${prefix}PROVIDER_SESSION_HEALTHY`]),
      providerHealthy: explicitHealthy(env[`${prefix}PROVIDER_HEALTHY`]),
      persistentProviderErrorCount: globalProviderErrors.count,
      bookFresh: book === null ? null : nowMs - book.observedAtMs >= 0 &&
        nowMs - book.observedAtMs <= (options.bookMaxAgeMs ?? 5_000),
      unknownCount: backlog.unknownCount ?? 0,
      oldestUnknownAgeMs: age(nowMs, backlog.oldestUnknownAtMs),
      stalePlacingCount: backlog.stalePlacingCount ?? 0,
      oldestStalePlacingAgeMs: age(nowMs, backlog.oldestStalePlacingAtMs),
      balanceExposureDriftCents: effectiveDrift,
      migrationHealthy: migration?.ok === 1,
      maintenanceAgeMs: age(nowMs, integerEnv(maintenanceAt)),
      telemetryAgeMs: age(nowMs, integerEnv(telemetryAt)),
    },
  });
}

function explicitHealthy(value: string | undefined): boolean | null {
  return value === "1" ? true : value === "0" ? false : null;
}

function integerEnv(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function age(nowMs: number, thenMs: number | null): number | null {
  return thenMs === null || thenMs > nowMs ? null : nowMs - thenMs;
}

function normalizeOutPrefix(value: string): string {
  const prefix = value.trim().toUpperCase();
  if (!/^KALSHI_[A-Z0-9]+_[1-9][0-9]*_$/.test(prefix)) {
    throw new TypeError("out environment prefix must be canonical (KALSHI_<PARTNER>_<N>_)");
  }
  return prefix;
}

function validateThresholds(thresholds: ExecutionRiskThresholds): void {
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`);
    }
  }
}

type Deny = (code: ExecutionRiskCode, reason: string) => void;

function requiredBoolean(
  value: boolean | null,
  label: string,
  deny: Deny,
  unhealthyCode: ExecutionRiskCode,
): void {
  if (value === null) deny("CONFIG_MISSING", `${label} is unavailable`);
  else if (!value) deny(unhealthyCode, `${label} is unhealthy`);
}

function requiredNonNegativeInteger(
  value: number | null,
  label: string,
  deny: Deny,
): number | null {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    deny("CONFIG_MISSING", `${label} is unavailable or invalid`);
    return null;
  }
  return value;
}

function checkAge(
  value: number | null,
  label: string,
  maximum: number,
  code: ExecutionRiskCode,
  deny: Deny,
): void {
  const age = requiredNonNegativeInteger(value, `${label} age`, deny);
  if (age !== null && age > maximum) deny(code, `${label} age ${age}ms exceeds ${maximum}ms`);
}
import type { Database } from "bun:sqlite";
import { EXECUTION_MIGRATIONS } from "./sql.ts";
