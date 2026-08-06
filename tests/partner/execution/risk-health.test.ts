import { describe, expect, test } from "bun:test";
import {
  evaluateStoredExecutionRiskHealth,
  evaluateExecutionRiskHealth,
  loadAndEvaluateExecutionRiskHealth,
  loadExecutionRiskHealthInput,
  type ExecutionRiskHealthInput,
  type ExecutionRiskSignals,
} from "../../../src/partner/execution/risk-health.ts";
import { Database } from "bun:sqlite";
import { migrateExecutionSchema } from "../../../src/partner/execution/sql.ts";

const signals: ExecutionRiskSignals = {
  providerSessionHealthy: true,
  providerHealthy: true,
  bookFresh: true,
  unknownCount: 0,
  oldestUnknownAgeMs: null,
  stalePlacingCount: 0,
  oldestStalePlacingAgeMs: null,
  balanceExposureDriftCents: 0,
  migrationHealthy: true,
  maintenanceAgeMs: 1_000,
  telemetryAgeMs: 1_000,
};

function healthy(overrides: Partial<ExecutionRiskHealthInput> = {}): ExecutionRiskHealthInput {
  return {
    ...signals,
    environment: "demo",
    executionEnabled: true,
    prodArmed: false,
    globalKillSwitch: false,
    outKillSwitch: false,
    thresholds: {
      maxUnknownCount: 0,
      maxUnknownAgeMs: 120_000,
      maxStalePlacingCount: 0,
      maxBalanceExposureDriftCents: 0,
      maxMaintenanceAgeMs: 120_000,
      maxTelemetryAgeMs: 120_000,
    },
    ...overrides,
  };
}

describe("authorized execution risk health", () => {
  test("implements the demo and production arming truth table", () => {
    expect(evaluateExecutionRiskHealth(healthy())).toEqual({
      healthy: true,
      codes: [],
      findings: [],
    });
    expect(evaluateExecutionRiskHealth(healthy({ environment: "prod" })).codes).toContain(
      "PROD_NOT_ARMED",
    );
    expect(evaluateExecutionRiskHealth(healthy({
      environment: "prod",
      prodArmed: true,
    })).healthy).toBeTrue();
    expect(evaluateExecutionRiskHealth(healthy({ executionEnabled: false })).codes).toContain(
      "EXECUTION_DISABLED",
    );
  });

  test("global and per-out kill switches independently fail closed", () => {
    expect(evaluateExecutionRiskHealth(healthy({ globalKillSwitch: true })).codes).toEqual([
      "GLOBAL_KILL_SWITCH",
    ]);
    expect(evaluateExecutionRiskHealth(healthy({ outKillSwitch: true })).codes).toEqual([
      "OUT_KILL_SWITCH",
    ]);
  });

  test("rejects unhealthy provider, book, migration, maintenance, and telemetry", () => {
    const decision = evaluateExecutionRiskHealth(healthy({
      providerSessionHealthy: false,
      providerHealthy: false,
      bookFresh: false,
      migrationHealthy: false,
      maintenanceAgeMs: 120_001,
      telemetryAgeMs: 120_001,
    }));
    expect(decision.codes).toEqual([
      "PROVIDER_SESSION_UNHEALTHY",
      "PROVIDER_UNHEALTHY",
      "BOOK_STALE",
      "MIGRATION_UNHEALTHY",
      "MAINTENANCE_STALE",
      "TELEMETRY_STALE",
    ]);
  });

  test("enforces ambiguous outcome, stale placement, and drift thresholds", () => {
    const decision = evaluateExecutionRiskHealth(healthy({
      unknownCount: 2,
      oldestUnknownAgeMs: 120_001,
      stalePlacingCount: 1,
      oldestStalePlacingAgeMs: 60_000,
      balanceExposureDriftCents: 1,
    }));
    expect(decision.codes).toEqual([
      "UNKNOWN_BACKLOG_COUNT",
      "UNKNOWN_BACKLOG_AGE",
      "STALE_PLACING_BACKLOG",
      "BALANCE_EXPOSURE_DRIFT",
    ]);
  });

  test("missing or invalid runtime evidence fails closed with stable config code", () => {
    const decision = evaluateExecutionRiskHealth(healthy({
      environment: null,
      providerSessionHealthy: null,
      unknownCount: null,
      balanceExposureDriftCents: -1,
      maintenanceAgeMs: null,
    }));
    expect(decision.healthy).toBeFalse();
    expect(decision.codes).toEqual(["CONFIG_MISSING"]);
    expect(decision.findings.length).toBeGreaterThan(4);
  });

  test("loader reads only explicit environment and scoped kill authority", () => {
    const input = loadExecutionRiskHealthInput({
      env: {
        KALSHI_ENV: "demo",
        KALSHI_AUTHORIZED_EXECUTION_ENABLED: "1",
        KALSHI_PROD_ARMED: "0",
        KALSHI_EXECUTION_KILL_SWITCH: "0",
        KALSHI_SPORTS_1_EXECUTION_KILL_SWITCH: "1",
      },
      outEnvPrefix: "kalshi_sports_1_",
      signals,
    });
    expect(input).toMatchObject({
      environment: "demo",
      executionEnabled: true,
      prodArmed: false,
      globalKillSwitch: false,
      outKillSwitch: true,
    });
    expect(evaluateExecutionRiskHealth(input).codes).toEqual(["OUT_KILL_SWITCH"]);
  });

  test("unset and misspelled environment configuration cannot become healthy", () => {
    expect(loadAndEvaluateExecutionRiskHealth({
      env: { KALSHI_AUTHORIZED_EXECUTION_ENABLED: "1" },
      outEnvPrefix: "KALSHI_SPORTS_1_",
      signals,
    }).codes).toContain("CONFIG_MISSING");
    expect(() => loadExecutionRiskHealthInput({
      env: {},
      outEnvPrefix: "SPORTS_1_",
      signals,
    })).toThrow(/canonical/);
  });

  test("store-backed loader binds backlog, book, migrations, and explicit telemetry", () => {
    const db = new Database(":memory:");
    migrateExecutionSchema(db, 1_000);
    db.exec(`CREATE TABLE book_ticks (
      id INTEGER PRIMARY KEY, ticker TEXT, ts INTEGER NOT NULL, recv_ts INTEGER,
      levels_json TEXT NOT NULL, source TEXT NOT NULL
    )`);
    db.query("INSERT INTO book_ticks VALUES (1, 'KXTEST', 9_999, 9_999, '{}', 'test')").run();
    const env = {
      KALSHI_ENV: "demo",
      KALSHI_AUTHORIZED_EXECUTION_ENABLED: "1",
      KALSHI_SPORTS_1_PROVIDER_SESSION_HEALTHY: "1",
      KALSHI_SPORTS_1_PROVIDER_HEALTHY: "1",
      KALSHI_SPORTS_1_BALANCE_EXPOSURE_DRIFT_CENTS: "0",
      KALSHI_SPORTS_1_MAINTENANCE_AT_MS: "9999",
      KALSHI_SPORTS_1_TELEMETRY_AT_MS: "9999",
    };
    expect(evaluateStoredExecutionRiskHealth({
      db, outId: "out-SPORTS-1", ticker: "KXTEST", outEnvPrefix: "KALSHI_SPORTS_1_",
      env, nowMs: 10_000,
    })).toMatchObject({ healthy: true, codes: [] });
    expect(evaluateStoredExecutionRiskHealth({
      db, outId: "out-SPORTS-1", ticker: "KXTEST", outEnvPrefix: "KALSHI_SPORTS_1_",
      env: { ...env, KALSHI_SPORTS_1_TELEMETRY_AT_MS: undefined }, nowMs: 10_000,
    }).codes).toContain("CONFIG_MISSING");
    db.close();
  });
});
