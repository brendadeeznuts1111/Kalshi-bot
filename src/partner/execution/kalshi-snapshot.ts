import type { Database } from "bun:sqlite";
import type { BookLevel, BookSnapshot } from "../../institutions/alpha-signal-types.ts";
import type {
  ApprovedAuthorization,
  AuthorizationPolicy,
} from "../authorization/domain.ts";
import type {
  BetRequest,
  ExecutionDependencies,
  ExecutionSnapshot,
} from "./domain.ts";
import { decimalOddsToKalshiPriceCents } from "./kalshi.ts";

export type KalshiExecutionSide = "yes" | "no";

export interface KalshiMarketExecutionQuote {
  ticker: string;
  side: KalshiExecutionSide;
  priceCents: number;
  decimalOdds: number;
  availableContracts: number;
  /** Executable top-level cost in integer minor currency units. */
  marketLiquidity: number;
  observedAtMs: number;
  ageMs: number;
  fresh: boolean;
  source: string;
}

export interface LoadKalshiMarketQuoteInput {
  ticker: string;
  side: KalshiExecutionSide;
  nowMs?: number;
  maxAgeMs?: number;
}

export interface KalshiExecutionSnapshotDependencies {
  db: Database;
  side:
    | KalshiExecutionSide
    | ((authorization: ApprovedAuthorization, request: BetRequest) => KalshiExecutionSide);
  loadCurrentPolicy: (
    authorization: ApprovedAuthorization,
    request: BetRequest,
  ) => Promise<AuthorizationPolicy> | AuthorizationPolicy;
  loadSitePerBetMax: (
    authorization: ApprovedAuthorization,
    request: BetRequest,
  ) => Promise<number> | number;
  loadAvailableBalance: (
    authorization: ApprovedAuthorization,
    request: BetRequest,
  ) => Promise<number> | number;
  isProviderSessionValid: (
    authorization: ApprovedAuthorization,
  ) => Promise<boolean> | boolean;
  isRiskHealthy: () => Promise<boolean> | boolean;
  now?: () => number;
  maxAgeMs?: number;
}

type BookTickRow = {
  ts: number;
  recvTs: number | null;
  levelsJson: string;
  source: string;
};

const DEFAULT_MAX_BOOK_AGE_MS = 5_000;

/** Load the latest persisted Kalshi book and derive the executable quote for one outcome side. */
export function loadKalshiMarketExecutionQuote(
  db: Database,
  input: LoadKalshiMarketQuoteInput,
): KalshiMarketExecutionQuote {
  const ticker = input.ticker.trim();
  if (!ticker) throw new TypeError("Kalshi market ticker must not be empty");
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_BOOK_AGE_MS;
  assertEpochMs(nowMs, "quote clock");
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    throw new TypeError("maximum Kalshi book age must be a non-negative safe integer");
  }

  const row = db
    .query(
      `SELECT ts, recv_ts AS recvTs, levels_json AS levelsJson, source
       FROM book_ticks
       WHERE ticker = $ticker
       ORDER BY COALESCE(recv_ts, ts) DESC, id DESC
       LIMIT 1`,
    )
    .get({ $ticker: ticker }) as BookTickRow | null;
  if (row === null) throw new Error(`No Kalshi book snapshot is available for ${ticker}`);

  const book = parsePersistedBook(row.levelsJson, ticker);
  if (book.crossed || isCrossed(book)) {
    throw new Error(`Kalshi book snapshot is crossed for ${ticker}`);
  }
  const level = bestBuyLevel(book, input.side);
  if (level === null) {
    throw new Error(`Kalshi book has no executable ${input.side.toUpperCase()} liquidity for ${ticker}`);
  }
  const observedAtMs = row.recvTs ?? row.ts;
  assertEpochMs(observedAtMs, "book observation");
  const ageMs = nowMs - observedAtMs;
  const marketLiquidity = safeMultiply(level.priceCents, level.size);
  return {
    ticker,
    side: input.side,
    priceCents: level.priceCents,
    decimalOdds: 100 / level.priceCents,
    availableContracts: level.size,
    marketLiquidity,
    observedAtMs,
    ageMs,
    fresh: ageMs >= 0 && ageMs <= maxAgeMs,
    source: row.source,
  };
}

/** Compose the persisted quote with account/policy health for executeAuthorizedBet(). */
export function createKalshiExecutionSnapshotLoader(
  dependencies: KalshiExecutionSnapshotDependencies,
): ExecutionDependencies["loadSnapshot"] {
  return async (authorization, request): Promise<ExecutionSnapshot> => {
    const side =
      typeof dependencies.side === "function"
        ? dependencies.side(authorization, request)
        : dependencies.side;
    if (request.selection.toLowerCase() !== side) {
      throw new Error(
        `Execution selection ${request.selection} does not match Kalshi ${side.toUpperCase()} snapshot side`,
      );
    }
    const nowMs = dependencies.now?.() ?? Date.now();
    const quote = loadKalshiMarketExecutionQuote(dependencies.db, {
      ticker: request.marketId,
      side,
      nowMs,
      maxAgeMs: dependencies.maxAgeMs,
    });
    const [
      currentPolicy,
      sitePerBetMax,
      availableBalance,
      providerSessionValid,
      riskHealthy,
    ] = await Promise.all([
      dependencies.loadCurrentPolicy(authorization, request),
      dependencies.loadSitePerBetMax(authorization, request),
      dependencies.loadAvailableBalance(authorization, request),
      dependencies.isProviderSessionValid(authorization),
      dependencies.isRiskHealthy(),
    ]);
    return {
      currentPolicy,
      oddsFresh:
        quote.fresh &&
        decimalOddsToKalshiPriceCents(request.decimalOdds) === quote.priceCents,
      providerSessionValid,
      riskHealthy,
      sitePerBetMax: requireMinorUnits(sitePerBetMax, "site per-bet maximum"),
      availableBalance: requireMinorUnits(availableBalance, "available balance"),
      marketLiquidity: quote.marketLiquidity,
      stakeQuantum: quote.priceCents,
    };
  };
}

function parsePersistedBook(levelsJson: string, ticker: string): BookSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(levelsJson);
  } catch {
    throw new Error(`Kalshi book snapshot JSON is malformed for ${ticker}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.bids) || !Array.isArray(parsed.asks)) {
    throw new Error(`Kalshi book snapshot shape is invalid for ${ticker}`);
  }
  const bids = parsed.bids.map((level) => parseLevel(level, ticker));
  const asks = parsed.asks.map((level) => parseLevel(level, ticker));
  return {
    ts: Number.isSafeInteger(parsed.ts) ? (parsed.ts as number) : 0,
    seq: Number.isSafeInteger(parsed.seq) ? (parsed.seq as number) : 0,
    bids,
    asks,
    ...(parsed.crossed === true ? { crossed: true } : {}),
  };
}

function parseLevel(value: unknown, ticker: string): BookLevel {
  if (!isRecord(value)) throw new Error(`Kalshi book contains an invalid level for ${ticker}`);
  const priceCents = value.priceCents;
  const size = value.size;
  if (
    !Number.isSafeInteger(priceCents) ||
    (priceCents as number) < 1 ||
    (priceCents as number) > 99 ||
    !Number.isSafeInteger(size) ||
    (size as number) <= 0
  ) {
    throw new Error(`Kalshi book contains an invalid price or size for ${ticker}`);
  }
  return { priceCents: priceCents as number, size: size as number };
}

function bestBuyLevel(book: BookSnapshot, side: KalshiExecutionSide): BookLevel | null {
  if (side === "yes") {
    return [...book.asks].sort((a, b) => a.priceCents - b.priceCents)[0] ?? null;
  }
  const bestYesBid = [...book.bids].sort((a, b) => b.priceCents - a.priceCents)[0];
  return bestYesBid
    ? { priceCents: 100 - bestYesBid.priceCents, size: bestYesBid.size }
    : null;
}

function isCrossed(book: BookSnapshot): boolean {
  const bestBid = Math.max(...book.bids.map((level) => level.priceCents), 0);
  const bestAsk = Math.min(...book.asks.map((level) => level.priceCents), 100);
  return bestBid > 0 && bestAsk < 100 && bestBid > bestAsk;
}

function safeMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new RangeError("Kalshi market liquidity exceeds safe integer range");
  return value;
}

function requireMinorUnits(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer in minor units`);
  }
  return value;
}

function assertEpochMs(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative epoch-millisecond integer`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
