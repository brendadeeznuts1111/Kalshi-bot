import type { Database } from "bun:sqlite";
import { migrateAuthorizationSchema } from "../authorization/sql.ts";
import { AUTHORIZED_CANCELLATION_SQL } from "./cancel-sql.ts";

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
  {
    id: "003_exposure_reconciliation_state",
    sql: `
      ALTER TABLE exposure_reservations ADD COLUMN reconciliation_owner TEXT CHECK (
        reconciliation_owner IS NULL OR length(reconciliation_owner) BETWEEN 1 AND 128
      );
      ALTER TABLE exposure_reservations ADD COLUMN reconciliation_lease_expires_at_ms INTEGER CHECK (
        reconciliation_lease_expires_at_ms IS NULL OR (
          typeof(reconciliation_lease_expires_at_ms) = 'integer'
          AND reconciliation_lease_expires_at_ms >= 0
        )
      );
      ALTER TABLE exposure_reservations ADD COLUMN reconciliation_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(reconciliation_attempts) = 'integer' AND reconciliation_attempts >= 0);
      ALTER TABLE exposure_reservations ADD COLUMN last_reconciliation_at_ms INTEGER CHECK (
        last_reconciliation_at_ms IS NULL OR (
          typeof(last_reconciliation_at_ms) = 'integer' AND last_reconciliation_at_ms >= 0
        )
      );
      ALTER TABLE exposure_reservations ADD COLUMN next_reconciliation_at_ms INTEGER CHECK (
        next_reconciliation_at_ms IS NULL OR (
          typeof(next_reconciliation_at_ms) = 'integer' AND next_reconciliation_at_ms >= 0
        )
      );
      ALTER TABLE exposure_reservations ADD COLUMN reconciliation_result TEXT CHECK (
        reconciliation_result IS NULL OR reconciliation_result IN ('confirmed', 'not_found', 'conflict', 'error')
      );
      ALTER TABLE exposure_reservations ADD COLUMN reconciliation_error TEXT CHECK (
        reconciliation_error IS NULL OR length(reconciliation_error) <= 2048
      );
      CREATE TRIGGER IF NOT EXISTS trg_exposure_reconciliation_lease_pair_insert
      BEFORE INSERT ON exposure_reservations
      WHEN (NEW.reconciliation_owner IS NULL) != (NEW.reconciliation_lease_expires_at_ms IS NULL)
      BEGIN
        SELECT RAISE(ABORT, 'reconciliation owner and lease expiry must be paired');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_exposure_reconciliation_lease_pair_update
      BEFORE UPDATE OF reconciliation_owner, reconciliation_lease_expires_at_ms ON exposure_reservations
      WHEN (NEW.reconciliation_owner IS NULL) != (NEW.reconciliation_lease_expires_at_ms IS NULL)
      BEGIN
        SELECT RAISE(ABORT, 'reconciliation owner and lease expiry must be paired');
      END;
      CREATE INDEX IF NOT EXISTS idx_exposure_reservations_reconciliation_eligible
        ON exposure_reservations (
          provider, status, next_reconciliation_at_ms,
          reconciliation_lease_expires_at_ms, last_reconciliation_at_ms, id
        ) WHERE status = 'unknown';
    `,
  },
  {
    id: "004_provider_order_lifecycle",
    sql: `
      CREATE TABLE provider_order_lifecycle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 128),
        out_id TEXT NOT NULL CHECK (length(out_id) BETWEEN 1 AND 256),
        environment TEXT NOT NULL CHECK (length(environment) BETWEEN 1 AND 64),
        provider_order_id TEXT NOT NULL CHECK (length(provider_order_id) BETWEEN 1 AND 512),
        client_order_id TEXT CHECK (
          client_order_id IS NULL OR length(client_order_id) BETWEEN 1 AND 512
        ),
        reservation_id INTEGER REFERENCES exposure_reservations(id),
        ticker TEXT NOT NULL CHECK (length(ticker) BETWEEN 1 AND 256),
        side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
        action TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
        unit_price_minor INTEGER NOT NULL CHECK (
          typeof(unit_price_minor) = 'integer' AND unit_price_minor >= 0
        ),
        ordered_quantity INTEGER NOT NULL CHECK (
          typeof(ordered_quantity) = 'integer' AND ordered_quantity > 0
        ),
        filled_quantity INTEGER NOT NULL CHECK (
          typeof(filled_quantity) = 'integer' AND filled_quantity >= 0
        ),
        remaining_quantity INTEGER NOT NULL CHECK (
          typeof(remaining_quantity) = 'integer' AND remaining_quantity >= 0
        ),
        cancelled_quantity INTEGER NOT NULL CHECK (
          typeof(cancelled_quantity) = 'integer' AND cancelled_quantity >= 0
        ),
        settled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (
          typeof(settled_quantity) = 'integer' AND settled_quantity >= 0
        ),
        provider_status TEXT NOT NULL CHECK (
          provider_status IN ('working', 'executed', 'cancelled')
        ),
        provider_updated_at_ms INTEGER CHECK (
          provider_updated_at_ms IS NULL OR (
            typeof(provider_updated_at_ms) = 'integer' AND provider_updated_at_ms >= 0
          )
        ),
        first_observed_at_ms INTEGER NOT NULL CHECK (
          typeof(first_observed_at_ms) = 'integer' AND first_observed_at_ms >= 0
        ),
        last_observed_at_ms INTEGER NOT NULL CHECK (
          typeof(last_observed_at_ms) = 'integer' AND last_observed_at_ms >= 0
        ),
        UNIQUE (provider, out_id, provider_order_id),
        CHECK (filled_quantity + remaining_quantity + cancelled_quantity = ordered_quantity),
        CHECK (settled_quantity <= filled_quantity),
        CHECK (provider_status = 'working' OR remaining_quantity = 0)
      );
      CREATE UNIQUE INDEX idx_provider_order_lifecycle_client
        ON provider_order_lifecycle (provider, out_id, client_order_id)
        WHERE client_order_id IS NOT NULL;
      CREATE INDEX idx_provider_order_lifecycle_reservation
        ON provider_order_lifecycle (reservation_id);
      CREATE INDEX idx_provider_order_lifecycle_exposure
        ON provider_order_lifecycle (provider, out_id, provider_status, settled_quantity);

      CREATE TABLE provider_order_fills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_lifecycle_id INTEGER NOT NULL REFERENCES provider_order_lifecycle(id),
        provider TEXT NOT NULL,
        out_id TEXT NOT NULL,
        source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 512),
        provider_order_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
        action TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
        quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
        unit_price_minor INTEGER NOT NULL CHECK (
          typeof(unit_price_minor) = 'integer' AND unit_price_minor >= 0
        ),
        fee_minor INTEGER CHECK (
          fee_minor IS NULL OR (typeof(fee_minor) = 'integer' AND fee_minor >= 0)
        ),
        provider_created_at_ms INTEGER CHECK (
          provider_created_at_ms IS NULL OR (
            typeof(provider_created_at_ms) = 'integer' AND provider_created_at_ms >= 0
          )
        ),
        observed_at_ms INTEGER NOT NULL CHECK (
          typeof(observed_at_ms) = 'integer' AND observed_at_ms >= 0
        ),
        UNIQUE (provider, out_id, source_key)
      );
      CREATE INDEX idx_provider_order_fills_order
        ON provider_order_fills (order_lifecycle_id, provider_created_at_ms, id);

      CREATE TABLE provider_order_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_lifecycle_id INTEGER NOT NULL REFERENCES provider_order_lifecycle(id),
        provider TEXT NOT NULL,
        out_id TEXT NOT NULL,
        evidence_key TEXT NOT NULL CHECK (length(evidence_key) BETWEEN 1 AND 512),
        settled_quantity INTEGER NOT NULL CHECK (
          typeof(settled_quantity) = 'integer' AND settled_quantity > 0
        ),
        observed_at_ms INTEGER NOT NULL CHECK (
          typeof(observed_at_ms) = 'integer' AND observed_at_ms >= 0
        ),
        UNIQUE (order_lifecycle_id, evidence_key)
      );
      CREATE INDEX idx_provider_order_settlements_order
        ON provider_order_settlements (order_lifecycle_id, observed_at_ms, id);
    `,
  },
  {
    id: "005_execution_journal",
    sql: `
      CREATE TABLE execution_journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 1 AND 512),
        kind TEXT NOT NULL CHECK (
          kind IN ('reservation', 'order', 'fill', 'fee', 'cancel', 'settlement', 'adjustment', 'reversal')
        ),
        partner_code TEXT NOT NULL CHECK (length(partner_code) BETWEEN 1 AND 128),
        out_id TEXT NOT NULL CHECK (length(out_id) BETWEEN 1 AND 256),
        skin TEXT NOT NULL CHECK (length(skin) BETWEEN 1 AND 128),
        provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 128),
        currency TEXT NOT NULL CHECK (length(currency) BETWEEN 3 AND 12),
        reservation_id INTEGER REFERENCES exposure_reservations(id),
        provider_order_id TEXT,
        cash_delta_minor INTEGER NOT NULL CHECK (typeof(cash_delta_minor) = 'integer'),
        open_exposure_delta_minor INTEGER NOT NULL CHECK (
          typeof(open_exposure_delta_minor) = 'integer'
        ),
        realized_pnl_delta_minor INTEGER NOT NULL CHECK (
          typeof(realized_pnl_delta_minor) = 'integer'
        ),
        fee_delta_minor INTEGER NOT NULL CHECK (typeof(fee_delta_minor) = 'integer'),
        partner_split_delta_minor INTEGER NOT NULL CHECK (
          typeof(partner_split_delta_minor) = 'integer'
        ),
        reverses_entry_id INTEGER REFERENCES execution_journal_entries(id),
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
          json_valid(metadata_json) AND length(metadata_json) <= 16384
        ),
        created_at_ms INTEGER NOT NULL CHECK (
          typeof(created_at_ms) = 'integer' AND created_at_ms >= 0
        ),
        CHECK (
          (kind = 'reversal' AND reverses_entry_id IS NOT NULL)
          OR (kind != 'reversal' AND reverses_entry_id IS NULL)
        )
      );
      CREATE UNIQUE INDEX idx_execution_journal_single_reversal
        ON execution_journal_entries (reverses_entry_id)
        WHERE reverses_entry_id IS NOT NULL;
      CREATE INDEX idx_execution_journal_projection
        ON execution_journal_entries (partner_code, out_id, skin, currency, id);
      CREATE INDEX idx_execution_journal_reservation
        ON execution_journal_entries (reservation_id, id);
      CREATE INDEX idx_execution_journal_provider_order
        ON execution_journal_entries (provider, out_id, provider_order_id, id);
    `,
  },
  {
    id: "006_authorized_cancellations",
    sql: AUTHORIZED_CANCELLATION_SQL,
  },
  {
    id: "007_execution_actor_provenance",
    sql: `
      ALTER TABLE exposure_reservations ADD COLUMN actor_id TEXT CHECK (
        actor_id IS NULL OR length(actor_id) BETWEEN 1 AND 128
      );
      CREATE INDEX idx_exposure_reservations_actor
        ON exposure_reservations (actor_id, created_at_ms, id)
        WHERE actor_id IS NOT NULL;
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
