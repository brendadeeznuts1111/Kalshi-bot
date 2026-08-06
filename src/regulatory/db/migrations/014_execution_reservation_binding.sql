-- A provider execution reservation may prove at most one regulatory play.
-- Existing duplicate bindings intentionally make this migration fail closed so
-- an operator must reconcile the conflicting provenance before continuing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_plays_execution_reservation
  ON plays(execution_reservation_id)
  WHERE execution_reservation_id IS NOT NULL;
