import type { Database } from "bun:sqlite";

export interface DemoBalanceCheckpoint {
  id: number;
  partnerCode: string;
  outId: string;
  skin: string;
  balanceCents: number;
  effectiveAtMs: number;
  sourceSha256: string;
}

export function migrateDemoEvidenceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_balance_checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_code TEXT NOT NULL,
      out_id TEXT NOT NULL,
      skin TEXT NOT NULL,
      balance_cents INTEGER NOT NULL CHECK (typeof(balance_cents) = 'integer' AND balance_cents >= 0),
      effective_at_ms INTEGER NOT NULL CHECK (typeof(effective_at_ms) = 'integer' AND effective_at_ms >= 0),
      source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^a-f0-9]*'),
      created_at_ms INTEGER NOT NULL,
      UNIQUE (partner_code, out_id, skin, effective_at_ms)
    );
    CREATE INDEX IF NOT EXISTS idx_demo_balance_checkpoint_lane
      ON demo_balance_checkpoints (partner_code, out_id, skin, effective_at_ms DESC);
  `);
}

export function loadDemoBalanceCheckpoint(
  db: Database,
  lane: { partnerCode: string; outId: string; skin: string; atMs: number },
): DemoBalanceCheckpoint {
  const row = db.query(`
    SELECT id, partner_code, out_id, skin, balance_cents, effective_at_ms, source_sha256
    FROM demo_balance_checkpoints
    WHERE partner_code = $partner AND out_id = $outId AND skin = $skin
      AND effective_at_ms <= $atMs
    ORDER BY effective_at_ms DESC, id DESC LIMIT 1
  `).get({
    $partner: lane.partnerCode,
    $outId: lane.outId,
    $skin: lane.skin,
    $atMs: lane.atMs,
  }) as {
    id: number; partner_code: string; out_id: string; skin: string;
    balance_cents: number; effective_at_ms: number; source_sha256: string;
  } | null;
  if (!row) throw new Error("No persisted demo balance checkpoint covers the proof window");
  return {
    id: row.id, partnerCode: row.partner_code, outId: row.out_id, skin: row.skin,
    balanceCents: row.balance_cents, effectiveAtMs: row.effective_at_ms,
    sourceSha256: row.source_sha256,
  };
}

export function recordDemoBalanceCheckpoint(
  db: Database,
  input: Omit<DemoBalanceCheckpoint, "id"> & { createdAtMs: number },
): DemoBalanceCheckpoint {
  if (!Number.isSafeInteger(input.balanceCents) || input.balanceCents < 0) throw new TypeError("checkpoint balance is invalid");
  if (!Number.isSafeInteger(input.effectiveAtMs) || input.effectiveAtMs < 0) throw new TypeError("checkpoint time is invalid");
  if (!/^[a-f0-9]{64}$/.test(input.sourceSha256)) throw new TypeError("checkpoint source digest is invalid");
  db.query(`
    INSERT INTO demo_balance_checkpoints (
      partner_code, out_id, skin, balance_cents, effective_at_ms, source_sha256, created_at_ms
    ) VALUES ($partner, $outId, $skin, $balance, $effective, $source, $created)
    ON CONFLICT (partner_code, out_id, skin, effective_at_ms) DO NOTHING
  `).run({
    $partner: input.partnerCode, $outId: input.outId, $skin: input.skin,
    $balance: input.balanceCents, $effective: input.effectiveAtMs,
    $source: input.sourceSha256, $created: input.createdAtMs,
  });
  const checkpoint = loadDemoBalanceCheckpoint(db, { ...input, atMs: input.effectiveAtMs });
  if (checkpoint.effectiveAtMs !== input.effectiveAtMs || checkpoint.balanceCents !== input.balanceCents || checkpoint.sourceSha256 !== input.sourceSha256) {
    throw new Error("Demo balance checkpoint conflicts with immutable persisted evidence");
  }
  return checkpoint;
}
