import type { Database } from 'bun:sqlite';

export const AUTHORIZED_CANCELLATION_SQL = `
  CREATE TABLE IF NOT EXISTS authorized_cancellations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 256),
    reservation_id INTEGER NOT NULL UNIQUE REFERENCES exposure_reservations(id),
    ticket_id TEXT NOT NULL,
    partner_code TEXT NOT NULL,
    out_id TEXT NOT NULL,
    skin TEXT NOT NULL,
    authorization_id INTEGER NOT NULL REFERENCES account_authorizations(id),
    actor_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('intent', 'confirmed', 'rejected', 'unknown')),
    provider_response_json TEXT CHECK (
      provider_response_json IS NULL OR json_valid(provider_response_json)
    ),
    failure_reason TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_authorized_cancellations_status
    ON authorized_cancellations(status, updated_at_ms, id);
`;

export function migrateAuthorizedCancellationSchema(db: Database): void {
  db.exec(AUTHORIZED_CANCELLATION_SQL);
}
