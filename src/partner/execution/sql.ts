import type { Database } from "bun:sqlite";
import { migrateAuthorizationSchema } from "../authorization/sql.ts";

export const EXECUTION_MIGRATIONS = [
  {
    id: "001_exposure_reservations",
    sql: `
      CREATE TABLE IF NOT EXISTS exposure_reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 256),
        partner_code TEXT NOT NULL,
        out_id TEXT NOT NULL,
        skin TEXT NOT NULL,
        provider TEXT NOT NULL,
        authorization_id INTEGER NOT NULL REFERENCES account_authorizations(id),
        requested_stake INTEGER NOT NULL CHECK (
          typeof(requested_stake) = 'integer' AND requested_stake > 0
        ),
        effective_stake INTEGER NOT NULL CHECK (
          typeof(effective_stake) = 'integer' AND effective_stake > 0
        ),
        market_id TEXT NOT NULL,
        decimal_odds REAL NOT NULL CHECK (decimal_odds > 1.0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (
          status IN ('pending', 'placing', 'confirmed', 'rejected', 'unknown', 'cancelled', 'settled')
        ),
        reservation_expires_at_ms INTEGER NOT NULL CHECK (
          typeof(reservation_expires_at_ms) = 'integer' AND reservation_expires_at_ms >= 0
        ),
        placement_owner TEXT,
        ticket_id TEXT,
        provider_response_json TEXT CHECK (
          provider_response_json IS NULL OR json_valid(provider_response_json)
        ),
        failure_reason TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        CHECK (status != 'placing' OR placement_owner IS NOT NULL),
        CHECK (status != 'confirmed' OR ticket_id IS NOT NULL)
      );

      CREATE INDEX IF NOT EXISTS idx_exposure_reservations_lane_status
        ON exposure_reservations (partner_code, out_id, skin, status);
      CREATE INDEX IF NOT EXISTS idx_exposure_reservations_pending_expiry
        ON exposure_reservations (reservation_expires_at_ms, id)
        WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_exposure_reservations_daily
        ON exposure_reservations (partner_code, out_id, skin, created_at_ms, status);
    `,
  },
  {
    id: "002_exposure_reservation_selection",
    sql: `
      ALTER TABLE exposure_reservations
        ADD COLUMN selection TEXT NOT NULL DEFAULT 'legacy-unknown';
      CREATE INDEX IF NOT EXISTS idx_exposure_reservations_market_selection
        ON exposure_reservations (market_id, selection, status);
    `,
  },
] as const;

type MigrationRow = { migrationId: string }; // brand-ok — internal migration wire value

/** Apply authorization prerequisites and then all execution migrations. */
export function migrateExecutionSchema(db: Database, nowMs = Date.now()): string[] {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("migration time must be a non-negative epoch-millisecond integer");
  }
  migrateAuthorizationSchema(db, nowMs);
  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE IF NOT EXISTS _partner_execution_migrations (
    id TEXT PRIMARY KEY,
    applied_at_ms INTEGER NOT NULL
  )`);
  const applied = new Set(
    (
      db
        .query("SELECT id AS migrationId FROM _partner_execution_migrations")
        .all() as MigrationRow[]
    ).map((row) => row.migrationId),
  );
  const newlyApplied: string[] = [];
  for (const migration of EXECUTION_MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.run("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.query(
        `INSERT INTO _partner_execution_migrations (id, applied_at_ms)
         VALUES ($id, $nowMs)`,
      ).run({ $id: migration.id, $nowMs: nowMs });
      db.run("COMMIT");
      newlyApplied.push(migration.id);
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }
  return newlyApplied;
}

export const ensureExecutionSchema = migrateExecutionSchema;
