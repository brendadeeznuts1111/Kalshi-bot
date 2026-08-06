import type { Database } from "bun:sqlite";
import type { ExposureReservationId } from "./domain.ts";
import type { ProviderLifecycleSide } from "./provider-lifecycle.ts";

export const EXECUTION_JOURNAL_KINDS = [
  "reservation",
  "order",
  "fill",
  "fee",
  "cancel",
  "settlement",
  "adjustment",
  "reversal",
] as const;
export type ExecutionJournalKind = (typeof EXECUTION_JOURNAL_KINDS)[number];

export interface ExecutionJournalIdentity {
  partnerCode: string;
  outId: string;
  skin: string;
  provider: string;
  currency: string;
  reservationId: ExposureReservationId | null;
  providerOrderId: string | null;
}

export interface ExecutionJournalEntry extends ExecutionJournalIdentity {
  id: number;
  sourceKey: string;
  kind: ExecutionJournalKind;
  cashDeltaMinor: number;
  openExposureDeltaMinor: number;
  realizedPnlDeltaMinor: number;
  feeDeltaMinor: number;
  partnerSplitDeltaMinor: number;
  reversesEntryId: number | null;
  metadata: Record<string, unknown>;
  createdAtMs: number;
}

export interface AppendExecutionJournalEntry extends ExecutionJournalIdentity {
  sourceKey: string;
  kind: Exclude<ExecutionJournalKind, "reversal">;
  cashDeltaMinor: number;
  openExposureDeltaMinor: number;
  realizedPnlDeltaMinor: number;
  feeDeltaMinor: number;
  partnerSplitDeltaMinor: number;
  metadata?: Record<string, unknown>;
  createdAtMs: number;
}

export interface ExecutionJournalProjection {
  partnerCode: string;
  outId: string;
  skin: string;
  currency: string;
  cashDeltaMinor: number;
  openExposureMinor: number;
  realizedPnlMinor: number;
  feesMinor: number;
  partnerSplitMinor: number;
  entryCount: number;
}

export interface ProviderDriftResult {
  expectedCashMinor: number;
  providerCashMinor: number;
  cashDriftMinor: number;
  expectedOpenExposureMinor: number;
  providerOpenExposureMinor: number;
  exposureDriftMinor: number;
}

type JournalRow = {
  id: number;
  source_key: string;
  kind: ExecutionJournalKind;
  partner_code: string;
  out_id: string;
  skin: string;
  provider: string;
  currency: string;
  reservation_id: number | null;
  provider_order_id: string | null;
  cash_delta_minor: number;
  open_exposure_delta_minor: number;
  realized_pnl_delta_minor: number;
  fee_delta_minor: number;
  partner_split_delta_minor: number;
  reverses_entry_id: number | null;
  metadata_json: string;
  created_at_ms: number;
};

export function appendExecutionJournalEntry(
  db: Database,
  input: AppendExecutionJournalEntry,
): { created: boolean; entry: ExecutionJournalEntry } {
  validateAppend(input);
  return appendValidated(db, { ...input, reversesEntryId: null });
}

export function appendReservationJournalEntry(
  db: Database,
  input: ExecutionJournalIdentity & {
    sourceKey: string;
    exposureMinor: number;
    createdAtMs: number;
  },
) {
  nonNegative(input.exposureMinor, "reservation exposure");
  return appendExecutionJournalEntry(db, {
    ...input,
    kind: "reservation",
    cashDeltaMinor: 0,
    openExposureDeltaMinor: input.exposureMinor,
    realizedPnlDeltaMinor: 0,
    feeDeltaMinor: 0,
    partnerSplitDeltaMinor: 0,
    metadata: { exposureMinor: input.exposureMinor },
  });
}

export function appendOrderJournalEntry(
  db: Database,
  input: ExecutionJournalIdentity & {
    sourceKey: string;
    orderedQuantity: number;
    unitPriceMinor: number;
    createdAtMs: number;
  },
) {
  positive(input.orderedQuantity, "ordered quantity");
  nonNegative(input.unitPriceMinor, "order unit price");
  return appendExecutionJournalEntry(db, {
    ...input,
    kind: "order",
    cashDeltaMinor: 0,
    openExposureDeltaMinor: 0,
    realizedPnlDeltaMinor: 0,
    feeDeltaMinor: 0,
    partnerSplitDeltaMinor: 0,
    metadata: {
      orderedQuantity: input.orderedQuantity,
      unitPriceMinor: input.unitPriceMinor,
    },
  });
}

/** Fill principal and fee are distinct deterministic entries. */
export function appendBinaryFillJournalEntries(
  db: Database,
  input: ExecutionJournalIdentity & {
    fillSourceKey: string;
    quantity: number;
    unitPriceMinor: number;
    feeMinor: number;
    partnerSplitBps: number;
    createdAtMs: number;
  },
): { fill: ExecutionJournalEntry; fee: ExecutionJournalEntry | null } {
  positive(input.quantity, "fill quantity");
  nonNegative(input.unitPriceMinor, "fill unit price");
  nonNegative(input.feeMinor, "fill fee");
  basisPoints(input.partnerSplitBps);
  const cost = safeProduct(input.quantity, input.unitPriceMinor);
  const transaction = db.transaction(() => {
    const fill = appendExecutionJournalEntry(db, {
      ...input,
      sourceKey: `${bounded(input.fillSourceKey, "fill source key", 480)}:principal`,
      kind: "fill",
      cashDeltaMinor: -cost,
      openExposureDeltaMinor: 0,
      realizedPnlDeltaMinor: 0,
      feeDeltaMinor: 0,
      partnerSplitDeltaMinor: 0,
      metadata: { quantity: input.quantity, unitPriceMinor: input.unitPriceMinor },
    }).entry;
    const fee = input.feeMinor === 0
      ? null
      : appendExecutionJournalEntry(db, {
          ...input,
          sourceKey: `${input.fillSourceKey}:fee`,
          kind: "fee",
          cashDeltaMinor: -input.feeMinor,
          openExposureDeltaMinor: 0,
          realizedPnlDeltaMinor: -input.feeMinor,
          feeDeltaMinor: input.feeMinor,
          partnerSplitDeltaMinor: splitMinor(-input.feeMinor, input.partnerSplitBps),
          metadata: { fillSourceKey: input.fillSourceKey },
        }).entry;
    return { fill, fee };
  });
  return transaction.immediate();
}

export function appendCancellationJournalEntry(
  db: Database,
  input: ExecutionJournalIdentity & {
    sourceKey: string;
    cancelledQuantity: number;
    unitPriceMinor: number;
    createdAtMs: number;
  },
) {
  nonNegative(input.cancelledQuantity, "cancelled quantity");
  nonNegative(input.unitPriceMinor, "cancel unit price");
  const released = safeProduct(input.cancelledQuantity, input.unitPriceMinor);
  return appendExecutionJournalEntry(db, {
    ...input,
    kind: "cancel",
    cashDeltaMinor: 0,
    openExposureDeltaMinor: -released,
    realizedPnlDeltaMinor: 0,
    feeDeltaMinor: 0,
    partnerSplitDeltaMinor: 0,
    metadata: {
      cancelledQuantity: input.cancelledQuantity,
      unitPriceMinor: input.unitPriceMinor,
    },
  });
}

export function appendBinarySettlementJournalEntry(
  db: Database,
  input: ExecutionJournalIdentity & {
    sourceKey: string;
    quantity: number;
    unitPriceMinor: number;
    side: ProviderLifecycleSide;
    marketResult: ProviderLifecycleSide;
    partnerSplitBps: number;
    /** Actual filled principal; defaults to quantity × unitPriceMinor. */
    costBasisMinor?: number;
    /** Reservation exposure to release; defaults to quantity × unitPriceMinor. */
    exposureMinor?: number;
    createdAtMs: number;
  },
) {
  positive(input.quantity, "settled quantity");
  nonNegative(input.unitPriceMinor, "settlement unit price");
  basisPoints(input.partnerSplitBps);
  if ((input.side !== "yes" && input.side !== "no") ||
      (input.marketResult !== "yes" && input.marketResult !== "no")) {
    throw new TypeError("binary settlement side and result must be yes or no");
  }
  const cost = input.costBasisMinor ?? safeProduct(input.quantity, input.unitPriceMinor);
  const exposure = input.exposureMinor ?? safeProduct(input.quantity, input.unitPriceMinor);
  nonNegative(cost, "settlement cost basis");
  nonNegative(exposure, "settlement exposure");
  const payout = input.side === input.marketResult ? safeProduct(input.quantity, 100) : 0;
  const realized = safeDifference(payout, cost);
  return appendExecutionJournalEntry(db, {
    ...input,
    kind: "settlement",
    cashDeltaMinor: payout,
    openExposureDeltaMinor: -exposure,
    realizedPnlDeltaMinor: realized,
    feeDeltaMinor: 0,
    partnerSplitDeltaMinor: splitMinor(realized, input.partnerSplitBps),
    metadata: {
      quantity: input.quantity,
      unitPriceMinor: input.unitPriceMinor,
      side: input.side,
      marketResult: input.marketResult,
      payoutMinor: payout,
      costBasisMinor: cost,
      exposureMinor: exposure,
    },
  });
}

/** Append the exact inverse; the original entry is never modified. */
export function appendExecutionJournalReversal(
  db: Database,
  input: { sourceKey: string; entryId: number; reason: string; createdAtMs: number },
): { created: boolean; entry: ExecutionJournalEntry } {
  positive(input.entryId, "journal entry ID");
  bounded(input.sourceKey, "reversal source key", 512);
  bounded(input.reason, "reversal reason", 2048);
  timestamp(input.createdAtMs, "reversal time");
  const original = getEntryById(db, input.entryId);
  if (original === null) throw new Error("journal entry to reverse was not found");
  if (original.kind === "reversal") throw new Error("a reversal entry cannot be reversed");
  return appendValidated(db, {
    ...original,
    sourceKey: input.sourceKey,
    kind: "reversal",
    cashDeltaMinor: negate(original.cashDeltaMinor),
    openExposureDeltaMinor: negate(original.openExposureDeltaMinor),
    realizedPnlDeltaMinor: negate(original.realizedPnlDeltaMinor),
    feeDeltaMinor: negate(original.feeDeltaMinor),
    partnerSplitDeltaMinor: negate(original.partnerSplitDeltaMinor),
    reversesEntryId: original.id,
    metadata: { reason: input.reason, originalSourceKey: original.sourceKey },
    createdAtMs: input.createdAtMs,
  });
}

export function projectExecutionJournal(
  db: Database,
  filter: { partnerCode: string; outId: string; skin: string; currency: string },
): ExecutionJournalProjection {
  const row = db.query(
    `SELECT COUNT(*) AS entryCount,
            COALESCE(SUM(cash_delta_minor), 0) AS cashDeltaMinor,
            COALESCE(SUM(open_exposure_delta_minor), 0) AS openExposureMinor,
            COALESCE(SUM(realized_pnl_delta_minor), 0) AS realizedPnlMinor,
            COALESCE(SUM(fee_delta_minor), 0) AS feesMinor,
            COALESCE(SUM(partner_split_delta_minor), 0) AS partnerSplitMinor
     FROM execution_journal_entries
     WHERE partner_code = $partnerCode AND out_id = $outId
       AND skin = $skin AND currency = $currency`,
  ).get({
    $partnerCode: filter.partnerCode,
    $outId: filter.outId,
    $skin: filter.skin,
    $currency: filter.currency,
  }) as Omit<ExecutionJournalProjection, "partnerCode" | "outId" | "skin" | "currency">;
  return {
    ...filter,
    cashDeltaMinor: safeSigned(row.cashDeltaMinor, "cash projection"),
    openExposureMinor: safeSigned(row.openExposureMinor, "exposure projection"),
    realizedPnlMinor: safeSigned(row.realizedPnlMinor, "P&L projection"),
    feesMinor: safeSigned(row.feesMinor, "fee projection"),
    partnerSplitMinor: safeSigned(row.partnerSplitMinor, "partner split projection"),
    entryCount: safeNonNegative(row.entryCount, "journal entry count"),
  };
}

export function getExecutionJournalEntryBySourceKey(
  db: Database,
  sourceKey: string,
): ExecutionJournalEntry | null {
  return getEntryBySourceKey(db, sourceKey);
}

/** Reproducible projections grouped by the owned partner/out/skin boundary. */
export function listExecutionJournalProjections(
  db: Database,
  filter: { partnerCode?: string; outId?: string; skin?: string } = {},
): ExecutionJournalProjection[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter.partnerCode !== undefined) {
    clauses.push("partner_code = $partnerCode");
    params.$partnerCode = filter.partnerCode;
  }
  if (filter.outId !== undefined) {
    clauses.push("out_id = $outId");
    params.$outId = filter.outId;
  }
  if (filter.skin !== undefined) {
    clauses.push("skin = $skin");
    params.$skin = filter.skin;
  }
  const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
  const rows = db.query(
    `SELECT partner_code AS partnerCode, out_id AS outId, skin, currency,
            COUNT(*) AS entryCount,
            COALESCE(SUM(cash_delta_minor), 0) AS cashDeltaMinor,
            COALESCE(SUM(open_exposure_delta_minor), 0) AS openExposureMinor,
            COALESCE(SUM(realized_pnl_delta_minor), 0) AS realizedPnlMinor,
            COALESCE(SUM(fee_delta_minor), 0) AS feesMinor,
            COALESCE(SUM(partner_split_delta_minor), 0) AS partnerSplitMinor
     FROM execution_journal_entries ${where}
     GROUP BY partner_code, out_id, skin, currency
     ORDER BY partner_code, out_id, skin, currency`,
  ).all(params) as ExecutionJournalProjection[];
  return rows.map((row) => ({
    ...row,
    cashDeltaMinor: safeSigned(row.cashDeltaMinor, "cash projection"),
    openExposureMinor: safeSigned(row.openExposureMinor, "exposure projection"),
    realizedPnlMinor: safeSigned(row.realizedPnlMinor, "P&L projection"),
    feesMinor: safeSigned(row.feesMinor, "fee projection"),
    partnerSplitMinor: safeSigned(row.partnerSplitMinor, "partner split projection"),
    entryCount: safeNonNegative(row.entryCount, "journal entry count"),
  }));
}

export function computeProviderJournalDrift(input: {
  projection: ExecutionJournalProjection;
  cashBaselineMinor: number;
  providerCashMinor: number;
  providerOpenExposureMinor: number;
}): ProviderDriftResult {
  for (const [label, value] of [
    ["cash baseline", input.cashBaselineMinor],
    ["provider cash", input.providerCashMinor],
    ["provider open exposure", input.providerOpenExposureMinor],
  ] as const) safeSigned(value, label);
  const expectedCashMinor = safeSum(input.cashBaselineMinor, input.projection.cashDeltaMinor);
  return {
    expectedCashMinor,
    providerCashMinor: input.providerCashMinor,
    cashDriftMinor: safeDifference(input.providerCashMinor, expectedCashMinor),
    expectedOpenExposureMinor: input.projection.openExposureMinor,
    providerOpenExposureMinor: input.providerOpenExposureMinor,
    exposureDriftMinor: safeDifference(
      input.providerOpenExposureMinor,
      input.projection.openExposureMinor,
    ),
  };
}

function appendValidated(
  db: Database,
  input: AppendExecutionJournalEntry & { reversesEntryId: number | null } | Omit<ExecutionJournalEntry, "id">,
): { created: boolean; entry: ExecutionJournalEntry } {
  const metadataJson = serializeMetadata(input.metadata);
  const prior = getEntryBySourceKey(db, input.sourceKey);
  if (prior !== null) {
    if (!sameEntry(prior, input, metadataJson)) {
      throw new Error("journal source key is already bound to different terms");
    }
    return { created: false, entry: prior };
  }
  const inserted = db.query(
    `INSERT INTO execution_journal_entries (
       source_key, kind, partner_code, out_id, skin, provider, currency,
       reservation_id, provider_order_id, cash_delta_minor,
       open_exposure_delta_minor, realized_pnl_delta_minor, fee_delta_minor,
       partner_split_delta_minor, reverses_entry_id, metadata_json, created_at_ms
     ) VALUES (
       $sourceKey, $kind, $partnerCode, $outId, $skin, $provider, $currency,
       $reservationId, $providerOrderId, $cash, $exposure, $pnl, $fee,
       $split, $reverses, $metadata, $createdAtMs
     ) ON CONFLICT(source_key) DO NOTHING RETURNING *`,
  ).get({
    $sourceKey: input.sourceKey,
    $kind: input.kind,
    $partnerCode: input.partnerCode,
    $outId: input.outId,
    $skin: input.skin,
    $provider: input.provider,
    $currency: input.currency,
    $reservationId: input.reservationId,
    $providerOrderId: input.providerOrderId,
    $cash: input.cashDeltaMinor,
    $exposure: input.openExposureDeltaMinor,
    $pnl: input.realizedPnlDeltaMinor,
    $fee: input.feeDeltaMinor,
    $split: input.partnerSplitDeltaMinor,
    $reverses: input.reversesEntryId,
    $metadata: metadataJson,
    $createdAtMs: input.createdAtMs,
  }) as JournalRow | null;
  if (inserted !== null) return { created: true, entry: mapEntry(inserted) };
  const existing = getEntryBySourceKey(db, input.sourceKey);
  if (existing === null || !sameEntry(existing, input, metadataJson)) {
    throw new Error("journal source key is already bound to different terms");
  }
  return { created: false, entry: existing };
}

function getEntryById(db: Database, id: number): ExecutionJournalEntry | null {
  const row = db.query("SELECT * FROM execution_journal_entries WHERE id = $id")
    .get({ $id: id }) as JournalRow | null;
  return row === null ? null : mapEntry(row);
}

function getEntryBySourceKey(db: Database, sourceKey: string): ExecutionJournalEntry | null {
  const row = db.query("SELECT * FROM execution_journal_entries WHERE source_key = $sourceKey")
    .get({ $sourceKey: sourceKey }) as JournalRow | null;
  return row === null ? null : mapEntry(row);
}

function sameEntry(
  entry: ExecutionJournalEntry,
  input: AppendExecutionJournalEntry & { reversesEntryId: number | null } | Omit<ExecutionJournalEntry, "id">,
  metadataJson: string,
): boolean {
  return entry.kind === input.kind &&
    entry.partnerCode === input.partnerCode && entry.outId === input.outId &&
    entry.skin === input.skin && entry.provider === input.provider &&
    entry.currency === input.currency && entry.reservationId === input.reservationId &&
    entry.providerOrderId === input.providerOrderId &&
    entry.cashDeltaMinor === input.cashDeltaMinor &&
    entry.openExposureDeltaMinor === input.openExposureDeltaMinor &&
    entry.realizedPnlDeltaMinor === input.realizedPnlDeltaMinor &&
    entry.feeDeltaMinor === input.feeDeltaMinor &&
    entry.partnerSplitDeltaMinor === input.partnerSplitDeltaMinor &&
    entry.reversesEntryId === input.reversesEntryId &&
    JSON.stringify(entry.metadata) === metadataJson && entry.createdAtMs === input.createdAtMs;
}

function validateAppend(input: AppendExecutionJournalEntry): void {
  bounded(input.sourceKey, "journal source key", 512);
  if (!EXECUTION_JOURNAL_KINDS.includes(input.kind)) throw new TypeError("invalid journal kind");
  bounded(input.partnerCode, "partner code", 128);
  bounded(input.outId, "out ID", 256);
  bounded(input.skin, "skin", 128);
  bounded(input.provider, "provider", 128);
  bounded(input.currency, "currency", 12);
  if (input.reservationId !== null) positive(input.reservationId, "reservation ID");
  if (input.providerOrderId !== null) bounded(input.providerOrderId, "provider order ID", 512);
  safeSigned(input.cashDeltaMinor, "cash delta");
  safeSigned(input.openExposureDeltaMinor, "open exposure delta");
  safeSigned(input.realizedPnlDeltaMinor, "realized P&L delta");
  safeSigned(input.feeDeltaMinor, "fee delta");
  safeSigned(input.partnerSplitDeltaMinor, "partner split delta");
  timestamp(input.createdAtMs, "journal entry time");
  serializeMetadata(input.metadata ?? {});
}

function mapEntry(row: JournalRow): ExecutionJournalEntry {
  return {
    id: row.id,
    sourceKey: row.source_key,
    kind: row.kind,
    partnerCode: row.partner_code,
    outId: row.out_id,
    skin: row.skin,
    provider: row.provider,
    currency: row.currency,
    reservationId: row.reservation_id as ExposureReservationId | null,
    providerOrderId: row.provider_order_id,
    cashDeltaMinor: row.cash_delta_minor,
    openExposureDeltaMinor: row.open_exposure_delta_minor,
    realizedPnlDeltaMinor: row.realized_pnl_delta_minor,
    feeDeltaMinor: row.fee_delta_minor,
    partnerSplitDeltaMinor: row.partner_split_delta_minor,
    reversesEntryId: row.reverses_entry_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    createdAtMs: row.created_at_ms,
  };
}

function serializeMetadata(metadata: Record<string, unknown> | undefined): string {
  const serialized = JSON.stringify(metadata ?? {});
  if (serialized.length > 16_384) throw new TypeError("journal metadata exceeds 16384 characters");
  return serialized;
}

function splitMinor(realizedPnlMinor: number, bps: number): number {
  const value = (BigInt(realizedPnlMinor) * BigInt(bps)) / 10_000n;
  const asNumber = Number(value);
  return safeSigned(asNumber, "partner split");
}

function basisPoints(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new TypeError("partner split basis points must be an integer from 0 to 10000");
  }
}

function bounded(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /\p{Cc}/u.test(normalized)) {
    throw new TypeError(`${label} must be a bounded non-control string`);
  }
  return normalized;
}

function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`);
}

function nonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
}

function timestamp(value: number, label: string): void {
  nonNegative(value, label);
}

function safeSigned(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`${label} must be a safe integer`);
  return value;
}

function safeNonNegative(value: number, label: string): number {
  nonNegative(value, label);
  return value;
}

function safeProduct(left: number, right: number): number {
  return safeSigned(left * right, "journal amount product");
}

function safeSum(left: number, right: number): number {
  return safeSigned(left + right, "journal amount sum");
}

function safeDifference(left: number, right: number): number {
  return safeSigned(left - right, "journal amount difference");
}

function negate(value: number): number {
  if (value === Number.MIN_SAFE_INTEGER) throw new Error("journal delta cannot be safely reversed");
  return -value;
}
