import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { DemoProofInput, DemoProofScenario } from "./demo-proof.ts";
import { executionIdempotencyKeyToUuid } from "./kalshi.ts";
import type { ProviderLifecycleBatch } from "./provider-lifecycle.ts";
import { loadDemoBalanceCheckpoint } from "./demo-evidence-checkpoint.ts";

export interface DemoProviderEvidenceCapture {
  environment: "demo" | "prod";
  capturedAtMs: number;
  lifecycle: ProviderLifecycleBatch;
  balanceCents: number;
  positions: Array<{ ticker: string; position: number }>;
}

export interface DemoProviderEvidenceSource {
  capture(): Promise<DemoProviderEvidenceCapture>;
}

export interface CollectDemoEvidenceOptions {
  db: Database;
  provider: DemoProviderEvidenceSource;
  partnerCode: string;
  outId: string;
  day: string;
  generatedAtMs: number;
  unknownResolutionSlaMs: number;
  scenarios: DemoProofInput["scenarios"];
  environment: Record<string, string | undefined>;
}

/**
 * Join read-only SQLite evidence with one normalized, cursor-complete provider
 * capture. Provider credentials and raw payloads never enter the proof shape.
 */
export async function collectDemoEvidence(
  options: CollectDemoEvidenceOptions,
): Promise<DemoProofInput> {
  const { startMs, endMs } = utcDayWindow(options.day);
  nonNegative(options.generatedAtMs, "generation time");
  nonNegative(options.unknownResolutionSlaMs, "unknown resolution SLA");
  const provider = await options.provider.capture();
  if (provider.environment !== "demo" || provider.lifecycle.environment !== "demo") {
    throw new Error("Demo evidence collector refuses production provider evidence");
  }
  if (options.environment.KALSHI_ENV === "prod" || options.environment.KALSHI_PROD_ARMED === "1") {
    throw new Error("Demo evidence collector refuses production or production-armed runtime state");
  }
  if (!provider.lifecycle.ordersCursorComplete || !provider.lifecycle.fillsCursorComplete) {
    throw new Error("Demo evidence collector requires cursor-complete provider lifecycle evidence");
  }
  if (provider.lifecycle.outId !== options.outId || provider.lifecycle.provider !== "kalshi") {
    throw new Error("Provider evidence does not match the requested Kalshi out");
  }
  if (
    provider.capturedAtMs < startMs || provider.capturedAtMs >= endMs ||
    options.generatedAtMs < provider.capturedAtMs || options.generatedAtMs >= endMs + 86_400_000
  ) throw new Error("Provider capture or generation time is outside the proof window");
  nonNegative(provider.balanceCents, "provider balance");

  const reservations = options.db.query(`
    SELECT id, status, idempotency_key, ticket_id, effective_stake,
           created_at_ms, last_reconciliation_at_ms
    FROM exposure_reservations
    WHERE partner_code = $partner AND out_id = $outId
      AND created_at_ms < $endMs
    ORDER BY id
  `).all({
    $partner: options.partnerCode,
    $outId: options.outId,
    $endMs: endMs,
  }) as Array<{
    id: number;
    status: string;
    idempotency_key: string;
    ticket_id: string | null;
    effective_stake: number;
    created_at_ms: number;
    last_reconciliation_at_ms: number | null;
  }>;

  const journalRows = options.db.query(`
    SELECT kind, cash_delta_minor, created_at_ms
    FROM execution_journal_entries
    WHERE partner_code = $partner AND out_id = $outId
      AND created_at_ms < $endMs
      AND created_at_ms >= $startMs
    ORDER BY id
  `).all({
    $partner: options.partnerCode,
    $outId: options.outId,
    $startMs: startMs,
    $endMs: endMs,
  }) as Array<{ kind: string; cash_delta_minor: number; created_at_ms: number }>;

  const receiptRows = options.db.query(`
    SELECT o.dedupe_key, o.status, o.lease_owner, o.created_at_ms, o.sent_at_ms
    FROM account_authorization_receipt_outbox o
    WHERE o.created_at_ms >= $startMs AND o.created_at_ms < $endMs
      AND (
        substr(o.dedupe_key, 1, length($breakerPrefix)) = $breakerPrefix
        OR EXISTS (
          SELECT 1
          FROM exposure_reservations scoped
          WHERE scoped.partner_code = $partner AND scoped.out_id = $outId
            AND (
              o.dedupe_key GLOB ('execution:' || scoped.id || ':*')
              OR o.dedupe_key GLOB ('cancel:' || scoped.id || ':*')
            )
        )
      )
    ORDER BY o.dedupe_key
  `).all({
    $partner: options.partnerCode,
    $outId: options.outId,
    $startMs: startMs,
    $endMs: endMs,
    $breakerPrefix: `execution:${options.outId}:breaker:`,
  }) as Array<{
    dedupe_key: string;
    status: "pending" | "sent" | "dead";
    lease_owner: string | null;
    created_at_ms: number;
    sent_at_ms: number | null;
  }>;
  const localPositionRows = options.db.query(`
    SELECT o.ticker, o.side, o.action,
           (o.filled_quantity - o.settled_quantity) AS quantity
    FROM provider_order_lifecycle o
    JOIN exposure_reservations r ON r.id = o.reservation_id
    WHERE r.partner_code = $partner AND r.out_id = $outId
      AND o.last_observed_at_ms < $endMs
      AND o.filled_quantity > o.settled_quantity
    ORDER BY o.id
  `).all({
    $partner: options.partnerCode,
    $outId: options.outId,
    $endMs: endMs,
  }) as Array<{ ticker: string; side: "yes" | "no"; action: "buy" | "sell"; quantity: number }>;

  const checkpoint = loadDemoBalanceCheckpoint(options.db, {
    partnerCode: options.partnerCode,
    outId: options.outId,
    skin: "*",
    atMs: startMs,
  });
  if (checkpoint.effectiveAtMs > startMs) throw new Error("Demo balance checkpoint must predate the proof day");
  const cashRows = options.db.query(`
    SELECT cash_delta_minor, created_at_ms
    FROM execution_journal_entries
    WHERE partner_code = $partner AND out_id = $outId
      AND created_at_ms > $checkpointMs AND created_at_ms <= $capturedAtMs
    ORDER BY id
  `).all({
    $partner: options.partnerCode,
    $outId: options.outId,
    $checkpointMs: checkpoint.effectiveAtMs,
    $capturedAtMs: provider.capturedAtMs,
  }) as Array<{ cash_delta_minor: number; created_at_ms: number }>;
  const localPositions = projectLocalPositions(localPositionRows);
  const localCashDelta = cashRows.reduce((sum, row) => safeAdd(sum, row.cash_delta_minor), 0);
  const localBalanceCents = safeAdd(checkpoint.balanceCents, localCashDelta);
  if (localBalanceCents < 0) throw new Error("Local balance projection cannot be negative");
  const localEvidence = { reservations, journalRows, cashRows, receiptRows, localPositionRows, localPositions, checkpoint };
  const providerEvidence = provider;

  return {
    environment: "demo",
    day: options.day,
    generatedAtMs: options.generatedAtMs,
    reservations: reservations.map((row) => ({
      id: row.id,
      status: row.status,
      clientOrderId: executionIdempotencyKeyToUuid(row.idempotency_key),
      ticketId: row.ticket_id,
      effectiveStake: row.effective_stake,
      createdAtMs: row.created_at_ms,
      reconciledAtMs: row.last_reconciliation_at_ms,
    })),
    providerOrders: provider.lifecycle.orders.map((row) => ({
      orderId: row.providerOrderId,
      clientOrderId: row.clientOrderId,
      ticker: row.ticker,
      status: row.status,
      count: row.orderedQuantity,
      filledCount: row.filledQuantity,
    })),
    providerFills: provider.lifecycle.fills.map((row) => ({
      fillId: row.sourceKey,
      orderId: row.providerOrderId,
      count: row.quantity,
      priceCents: row.unitPriceMinor,
    })),
    providerPositions: sortPositions(provider.positions),
    localPositions,
    journal: {
      reservationEntries: countKind(journalRows, "reservation"),
      orderEntries: countKind(journalRows, "order"),
      fillEntries: countKind(journalRows, "fill"),
      cancellationEntries: countKind(journalRows, "cancel"),
      receiptEntries: receiptRows.length,
    },
    receipts: receiptRows.map((row) => ({
      dedupeKey: row.dedupe_key,
      status: row.status === "sent" ? "delivered" : row.status === "dead"
        ? "dead_letter" : row.lease_owner === null ? "pending" : "leased",
      createdAtMs: row.created_at_ms,
      deliveredAtMs: row.sent_at_ms,
    })),
    balances: { providerBalanceCents: provider.balanceCents, localBalanceCents },
    limits: { unknownResolutionSlaMs: options.unknownResolutionSlaMs },
    productionBreakers: {
      productionExecutionEnabled:
        options.environment.KALSHI_ENV === "prod" &&
        options.environment.KALSHI_AUTHORIZED_EXECUTION_ENABLED === "1",
      productionArmed: options.environment.KALSHI_PROD_ARMED === "1",
    },
    provenance: {
      localEvidenceSha256: digest(localEvidence),
      providerEvidenceSha256: digest(providerEvidence),
      scenarioEvidenceSha256: digest(options.scenarios),
    },
    scenarios: copyScenarios(options.scenarios),
  };
}

function projectLocalPositions(
  fills: Array<{ ticker: string; side: "yes" | "no"; action: "buy" | "sell"; quantity: number }>,
): Array<{ ticker: string; position: number }> {
  const positions = new Map<string, number>();
  for (const fill of fills) {
    const direction = fill.side === "yes" ? 1 : -1;
    const action = fill.action === "buy" ? 1 : -1;
    positions.set(fill.ticker, safeAdd(positions.get(fill.ticker) ?? 0, fill.quantity * direction * action));
  }
  return sortPositions([...positions].map(([ticker, position]) => ({ ticker, position })));
}

function sortPositions(rows: Array<{ ticker: string; position: number }>) {
  for (const row of rows) {
    if (!row.ticker || !Number.isSafeInteger(row.position)) throw new TypeError("position evidence is malformed");
  }
  return [...rows].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function countKind(rows: Array<{ kind: string }>, kind: string): number {
  return rows.filter((row) => row.kind === kind).length;
}

function copyScenarios(scenarios: DemoProofInput["scenarios"]): DemoProofInput["scenarios"] {
  return Object.fromEntries(Object.entries(scenarios).map(([key, value]) => [key, { ...value }])) as Record<DemoProofScenario, { exercised: boolean; passed: boolean; evidence: string }>;
}

function utcDayWindow(day: string): { startMs: number; endMs: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TypeError("proof day must be YYYY-MM-DD");
  const startMs = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || new Date(startMs).toISOString().slice(0, 10) !== day) throw new TypeError("proof day is invalid");
  return { startMs, endMs: startMs + 86_400_000 };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new RangeError("demo evidence arithmetic overflow");
  return result;
}

function nonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
}
