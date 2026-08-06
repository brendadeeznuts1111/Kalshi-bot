-- Bind regulatory plays to authorized execution without coupling databases.
-- Reservation IDs are references to the execution event store and therefore
-- intentionally are not SQLite foreign keys in this regulatory database.

ALTER TABLE plays ADD COLUMN execution_idempotency_key TEXT;
ALTER TABLE plays ADD COLUMN execution_reservation_id INTEGER;
ALTER TABLE plays ADD COLUMN execution_reason TEXT;
ALTER TABLE plays ADD COLUMN execution_updated_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_execution_idempotency
  ON plays(execution_idempotency_key)
  WHERE execution_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plays_execution_status
  ON plays(status, execution_updated_at);
