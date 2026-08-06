import type { Database } from "bun:sqlite";
import type { KalshiClient } from "../../bot/kalshi-client.ts";
import type { BettingAccountRow } from "../registry.ts";
import { listActiveBettingAccounts } from "../registry.ts";
import { asExposureReservationId, type ExposureReservationId } from "./domain.ts";
import { reconcileUnknownCancellationFromLifecycle } from "./cancel.ts";
import { executionIdempotencyKeyToUuid } from "./kalshi.ts";
import { loadKalshiLifecycleBatch, type KalshiLifecycleLoadResult } from "./kalshi-lifecycle-loader.ts";
import {
  ingestProviderLifecycleAccountWithJournal,
  settleProviderLifecycleAccountOrderWithJournal,
} from "./provider-lifecycle-journal.ts";

export interface KalshiLifecycleSyncAccountResult {
  outId: string;
  environment: string | null;
  ok: boolean;
  pagesScanned: number;
  orders: number;
  fills: number;
  linkedOrders: number;
  orphanProviderOrders: number;
  orphanConfirmedReservations: number;
  journalEntriesAppended: number;
  settlementsApplied: number;
  unknownCancellationsConfirmed: number;
  cashDriftMinor: number;
  positionDriftContracts: number;
  accountingBaselineCreated: boolean;
  maxFillObservationLagMs: number | null;
  error?: string;
}

export interface KalshiLifecycleSyncResult {
  accounts: KalshiLifecycleSyncAccountResult[];
  failedAccounts: number;
  orphanProviderOrders: number;
  orphanConfirmedReservations: number;
  accountsWithDrift: number;
}

export interface KalshiLifecycleSyncDependencies {
  resolveClient: (account: BettingAccountRow) =>
    | Pick<KalshiClient, "environment" | "getLifecyclePage" | "getSettlementPage" | "getPositionsPage" | "getBalance">
    | Promise<Pick<KalshiClient, "environment" | "getLifecyclePage" | "getSettlementPage" | "getPositionsPage" | "getBalance">>;
  accounts?: BettingAccountRow[];
  now?: () => number;
  maxPagesPerFeed?: number;
  pageSize?: number;
}

/** Bounded, account-scoped lifecycle ingestion used by the one-shot worker. */
export async function syncKalshiProviderLifecycle(
  db: Database,
  dependencies: KalshiLifecycleSyncDependencies,
): Promise<KalshiLifecycleSyncResult> {
  const accounts = (dependencies.accounts ?? listActiveBettingAccounts(db))
    .filter((account) => account.status === "active" && account.provider.toLowerCase() === "kalshi")
    .sort((left, right) => left.id.localeCompare(right.id));
  const results: KalshiLifecycleSyncAccountResult[] = [];
  const syncObservedAtMs = dependencies.now?.() ?? Date.now();
  for (const account of accounts) {
    let load: KalshiLifecycleLoadResult;
    let settlements: Map<string, SettlementEvidence>;
    let providerPositions: Map<string, number>;
    let providerCashMinor: number;
    let environment: string | null = null;
    try {
      const client = await dependencies.resolveClient(account);
      environment = client.environment;
      const reservations = reservationByClientOrderId(db, account.id);
      load = await loadKalshiLifecycleBatch(client, {
        outId: account.id,
        observedAtMs: syncObservedAtMs,
        maxPagesPerFeed: dependencies.maxPagesPerFeed,
        pageSize: dependencies.pageSize,
        reservationForClientOrderId: (clientOrderId) => reservations.get(clientOrderId) ?? null,
      });
      if (!load.ok) {
        results.push({
          ...failed(account.id, load.pagesScanned, load.reason, environment),
          error: `${load.kind}:${load.feed}:${load.source}:${load.reason}`.slice(0, 768),
        });
        continue;
      }
      settlements = await loadSettlementEvidence(
        client,
        dependencies.maxPagesPerFeed ?? 10,
        dependencies.pageSize ?? 1_000,
      );
      providerPositions = await loadProviderPositions(
        client,
        dependencies.maxPagesPerFeed ?? 10,
        dependencies.pageSize ?? 1_000,
      );
      const balance = await client.getBalance();
      if (balance.balanceCents === null || !Number.isSafeInteger(balance.balanceCents)) {
        throw new Error("provider balance is unavailable");
      }
      providerCashMinor = balance.balanceCents;
    } catch (error) {
      results.push(failed(account.id, 0, error, environment));
      continue;
    }
    if (!load.ok) continue;
    try {
      const journal = ingestProviderLifecycleAccountWithJournal(db, load.batch);
      const providerOrderIds = new Set(load.batch.orders.map((order) => order.providerOrderId));
      const orphanConfirmedReservations = countOrphanConfirmedReservations(db, account.id, providerOrderIds);
      let settlementsApplied = 0;
      let unknownCancellationsConfirmed = 0;
      for (const order of load.batch.orders) {
        if (order.status === "cancelled" && order.reservationId !== null &&
            reconcileUnknownCancellationFromLifecycle(db, {
              reservationId: order.reservationId,
              providerOrderId: order.providerOrderId,
              observedAtMs: load.batch.observedAtMs,
            })) unknownCancellationsConfirmed++;
        const evidence = settlements.get(order.ticker);
        if (order.reservationId === null || evidence === undefined || order.filledQuantity === 0) continue;
        if (order.status === "working") continue;
        const settlement = settleProviderLifecycleAccountOrderWithJournal(db, {
          provider: load.batch.provider,
          outId: load.batch.outId,
          providerOrderId: order.providerOrderId,
          evidenceKey: evidence.evidenceKey,
          settledQuantity: order.filledQuantity,
          marketResult: evidence.marketResult,
          evidenceAtMs: evidence.settledAtMs,
        });
        if (settlement.journalCreated) settlementsApplied++;
      }
      const accounting = recordAccountingObservation(db, {
        outId: account.id,
        environment,
        observedAtMs: load.batch.observedAtMs,
        providerCashMinor,
        providerPositions,
      });
      results.push({
        outId: account.id,
        environment,
        ok: true,
        pagesScanned: load.pagesScanned,
        orders: load.batch.orders.length,
        fills: load.batch.fills.length,
        linkedOrders: journal.linkedOrders,
        orphanProviderOrders: journal.orphanOrders,
        orphanConfirmedReservations,
        journalEntriesAppended: journal.journalEntriesAppended,
        settlementsApplied,
        unknownCancellationsConfirmed,
        cashDriftMinor: accounting.cashDriftMinor,
        positionDriftContracts: accounting.positionDriftContracts,
        accountingBaselineCreated: accounting.baselineCreated,
        maxFillObservationLagMs: maxFillLag(load.batch.observedAtMs, load.batch.fills),
      });
    } catch (error) {
      results.push(failed(account.id, load.pagesScanned, error, environment));
    }
  }
  persistSyncRuns(db, results, syncObservedAtMs);
  return {
    accounts: results,
    failedAccounts: results.filter((result) => !result.ok).length,
    orphanProviderOrders: sum(results, "orphanProviderOrders"),
    orphanConfirmedReservations: sum(results, "orphanConfirmedReservations"),
    accountsWithDrift: results.filter((result) =>
      result.cashDriftMinor !== 0 || result.positionDriftContracts !== 0
    ).length,
  };
}

function reservationByClientOrderId(db: Database, outId: string): Map<string, ExposureReservationId> {
  const rows = db.query(
    `SELECT id, idempotency_key AS idempotencyKey FROM exposure_reservations
      WHERE provider = 'kalshi' AND out_id = $outId`,
  ).all({ $outId: outId }) as Array<{ id: number; idempotencyKey: string }>;
  const result = new Map<string, ExposureReservationId>();
  for (const row of rows) {
    const clientOrderId = executionIdempotencyKeyToUuid(row.idempotencyKey);
    if (result.has(clientOrderId)) throw new Error("reservation client order ID collision");
    result.set(clientOrderId, asExposureReservationId(row.id));
  }
  return result;
}

function countOrphanConfirmedReservations(
  db: Database,
  outId: string,
  providerOrderIds: Set<string>,
): number {
  const rows = db.query(
    `SELECT ticket_id AS ticketId FROM exposure_reservations
      WHERE provider = 'kalshi' AND out_id = $outId AND status = 'confirmed'`,
  ).all({ $outId: outId }) as Array<{ ticketId: string | null }>;
  return rows.filter((row) => row.ticketId === null || !providerOrderIds.has(row.ticketId)).length;
}

function maxFillLag(observedAtMs: number, fills: Array<{ providerCreatedAtMs: number | null }>): number | null {
  let maximum: number | null = null;
  for (const fill of fills) {
    if (fill.providerCreatedAtMs === null) continue;
    const lag = Math.max(0, observedAtMs - fill.providerCreatedAtMs);
    maximum = maximum === null ? lag : Math.max(maximum, lag);
  }
  return maximum;
}

function failed(
  outId: string,
  pagesScanned: number,
  error: unknown,
  environment: string | null = null,
): KalshiLifecycleSyncAccountResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    outId,
    environment,
    ok: false,
    pagesScanned,
    orders: 0,
    fills: 0,
    linkedOrders: 0,
    orphanProviderOrders: 0,
    orphanConfirmedReservations: 0,
    journalEntriesAppended: 0,
    settlementsApplied: 0,
    unknownCancellationsConfirmed: 0,
    cashDriftMinor: 0,
    positionDriftContracts: 0,
    accountingBaselineCreated: false,
    maxFillObservationLagMs: null,
    error: message.replace(/[\r\n\t]+/g, " ").slice(0, 768),
  };
}

function persistSyncRuns(
  db: Database,
  results: KalshiLifecycleSyncAccountResult[],
  observedAtMs: number,
): void {
  const insert = db.query(
    `INSERT INTO provider_lifecycle_sync_runs (
       provider, out_id, environment, status, observed_at_ms, metrics_json, error
     ) VALUES ('kalshi', $outId, $environment, $status, $observedAtMs, $metrics, $error)`,
  );
  const transaction = db.transaction(() => {
    for (const result of results) insert.run({
      $outId: result.outId,
      $environment: result.environment,
      $status: result.ok ? "ok" : "failed",
      $observedAtMs: observedAtMs,
      $metrics: JSON.stringify({
        pagesScanned: result.pagesScanned,
        orders: result.orders,
        fills: result.fills,
        linkedOrders: result.linkedOrders,
        orphanProviderOrders: result.orphanProviderOrders,
        orphanConfirmedReservations: result.orphanConfirmedReservations,
        journalEntriesAppended: result.journalEntriesAppended,
        settlementsApplied: result.settlementsApplied,
        unknownCancellationsConfirmed: result.unknownCancellationsConfirmed,
        cashDriftMinor: result.cashDriftMinor,
        positionDriftContracts: result.positionDriftContracts,
      }),
      $error: result.error ?? null,
    });
  });
  transaction.immediate();
}

async function loadProviderPositions(
  client: Pick<KalshiClient, "getPositionsPage">,
  maxPages: number,
  pageSize: number,
): Promise<Map<string, number>> {
  const positions = new Map<string, number>();
  let cursor = "";
  for (let page = 0; page < maxPages; page++) {
    const response = await client.getPositionsPage(cursor, pageSize);
    for (const wire of response.items) {
      const ticker = boundedString(wire.ticker, "position ticker");
      const quantity = Number(wire.position_fp ?? wire.position);
      if (!Number.isSafeInteger(quantity)) throw new Error("provider position is not a whole contract count");
      if (positions.has(ticker)) throw new Error("provider position ticker is duplicated");
      positions.set(ticker, quantity);
    }
    cursor = response.cursor;
    if (!cursor) return positions;
  }
  throw new Error("positions cursor remained after the bounded page limit");
}

function recordAccountingObservation(
  db: Database,
  input: {
    outId: string;
    environment: string;
    observedAtMs: number;
    providerCashMinor: number;
    providerPositions: Map<string, number>;
  },
): { cashDriftMinor: number; positionDriftContracts: number; baselineCreated: boolean } {
  const journal = db.query(
    `SELECT COALESCE(SUM(cash_delta_minor), 0) AS cash
       FROM execution_journal_entries WHERE provider = 'kalshi' AND out_id = $outId`,
  ).get({ $outId: input.outId }) as { cash: number };
  const prior = db.query(
    `SELECT cash_baseline_minor AS cashBaseline,
            journal_cash_at_baseline_minor AS journalAtBaseline
       FROM provider_accounting_observations
      WHERE provider = 'kalshi' AND out_id = $outId AND environment = $environment
      ORDER BY observed_at_ms DESC, id DESC LIMIT 1`,
  ).get({ $outId: input.outId, $environment: input.environment }) as {
    cashBaseline: number;
    journalAtBaseline: number;
  } | null;
  const baselineCreated = prior === null;
  const cashBaseline = prior?.cashBaseline ?? input.providerCashMinor;
  const journalAtBaseline = prior?.journalAtBaseline ?? journal.cash;
  const expectedCash = cashBaseline + journal.cash - journalAtBaseline;
  const cashDriftMinor = input.providerCashMinor - expectedCash;
  const localRows = db.query(
    `SELECT ticker,
            COALESCE(SUM((filled_quantity - settled_quantity) *
              CASE WHEN side = 'yes' THEN 1 ELSE -1 END *
              CASE WHEN action = 'buy' THEN 1 ELSE -1 END), 0) AS quantity
       FROM provider_order_lifecycle
      WHERE provider = 'kalshi' AND out_id = $outId AND reservation_id IS NOT NULL
      GROUP BY ticker`,
  ).all({ $outId: input.outId }) as Array<{ ticker: string; quantity: number }>;
  const local = new Map(localRows.map((row) => [row.ticker, row.quantity]));
  const tickers = new Set([...local.keys(), ...input.providerPositions.keys()]);
  const detail: Record<string, { local: number; provider: number; drift: number }> = {};
  let positionDriftContracts = 0;
  for (const ticker of [...tickers].sort()) {
    const localQuantity = local.get(ticker) ?? 0;
    const providerQuantity = input.providerPositions.get(ticker) ?? 0;
    const drift = providerQuantity - localQuantity;
    if (drift !== 0) detail[ticker] = { local: localQuantity, provider: providerQuantity, drift };
    positionDriftContracts += Math.abs(drift);
  }
  db.query(
    `INSERT INTO provider_accounting_observations (
       provider, out_id, environment, observed_at_ms, cash_baseline_minor,
       journal_cash_at_baseline_minor, journal_cash_minor, expected_cash_minor,
       provider_cash_minor, cash_drift_minor, position_drift_contracts,
       position_drift_json, is_baseline
     ) VALUES (
       'kalshi', $outId, $environment, $observedAtMs, $cashBaseline,
       $journalAtBaseline, $journalCash, $expectedCash, $providerCash, $cashDrift,
       $positionDrift, $positionJson, $isBaseline
     )`,
  ).run({
    $outId: input.outId,
    $environment: input.environment,
    $observedAtMs: input.observedAtMs,
    $cashBaseline: cashBaseline,
    $journalAtBaseline: journalAtBaseline,
    $journalCash: journal.cash,
    $expectedCash: expectedCash,
    $providerCash: input.providerCashMinor,
    $cashDrift: cashDriftMinor,
    $positionDrift: positionDriftContracts,
    $positionJson: JSON.stringify(detail),
    $isBaseline: baselineCreated ? 1 : 0,
  });
  return { cashDriftMinor, positionDriftContracts, baselineCreated };
}

interface SettlementEvidence {
  marketResult: "yes" | "no";
  settledAtMs: number;
  evidenceKey: string;
}

async function loadSettlementEvidence(
  client: Pick<KalshiClient, "getSettlementPage">,
  maxPages: number,
  pageSize: number,
): Promise<Map<string, SettlementEvidence>> {
  const result = new Map<string, SettlementEvidence>();
  let cursor = "";
  for (let page = 0; page < maxPages; page++) {
    const response = await client.getSettlementPage(cursor, pageSize);
    for (const wire of response.items) {
      const ticker = boundedString(wire.ticker, "settlement ticker");
      const marketResult = wire.market_result;
      if (marketResult !== "yes" && marketResult !== "no") continue;
      const settledAtMs = Date.parse(boundedString(wire.settled_time, "settlement time"));
      if (!Number.isSafeInteger(settledAtMs) || settledAtMs < 0) {
        throw new Error("settlement time is malformed");
      }
      const evidence: SettlementEvidence = {
        marketResult,
        settledAtMs,
        evidenceKey: `kalshi-settlement:${ticker}:${settledAtMs}:${marketResult}`,
      };
      const prior = result.get(ticker);
      if (prior && JSON.stringify(prior) !== JSON.stringify(evidence)) {
        throw new Error("settlement ticker has conflicting provider evidence");
      }
      result.set(ticker, evidence);
    }
    cursor = response.cursor;
    if (!cursor) return result;
  }
  throw new Error("settlement cursor remained after the bounded page limit");
}

function boundedString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new Error(`${label} is malformed`);
  }
  return value.trim();
}

function sum(
  results: KalshiLifecycleSyncAccountResult[],
  key: "orphanProviderOrders" | "orphanConfirmedReservations",
): number {
  return results.reduce((total, result) => total + result[key], 0);
}
