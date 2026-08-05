/**
 * ledger-types.ts — canonical money/trade vocabulary for the Kalshi bot.
 *
 * Wire shapes sourced from Kalshi API docs (2026-07-28):
 *   - GET /portfolio/balance   → KalshiBalanceWire
 *   - GET /portfolio/positions → KalshiMarketPositionWire / KalshiEventPositionWire
 *   - GET /portfolio/fills     → KalshiFillWire
 *   - GET /portfolio/orders    → KalshiOrderWire (fields per docs mirror; verify
 *     against a live response when credentials are next exercised)
 *
 * Kalshi is mid-migration to fixed-point: many values ship BOTH as legacy
 * integer cents (`balance`, `yes_price`) and as fixed-point dollar strings
 * (`balance_dollars`, `yes_price_dollars`, `position_fp`, `count_fp`).
 *
 * Normalization rules (the whole codebase consumes Normalized*, never wire):
 *   - money: integer cents (`*Cents`) is canonical; dollar strings parsed via
 *     dollarsToCents (round-half-up); legacy integer fields win when present.
 *   - counts: integer contracts (`count`, `position`); fractional `_fp` values
 *     are parsed to number and flagged via `fractional: true` — HQ displays
 *     them but order entry stays integer-only.
 *   - times: ISO strings → `*AtMs` epoch millis.
 *
 * Deposits/withdrawals: Kalshi has NO programmatic deposit/withdraw endpoints
 * (bank rails via web UI). Ledger codes DEP/WDL exist for OUR reconciliation
 * records only — see glossary.ts.
 */

// ── Wire types (snake_case, exactly as returned) ──

export type KalshiBalanceWire = {
  balance?: number; // cents, legacy int
  balance_dollars?: string;
  portfolio_value?: number; // cents
  portfolio_value_dollars?: string;
  updated_ts?: number; // unix seconds
};

export type KalshiMarketPositionWire = {
  ticker?: string;
  position?: number; // legacy int contracts (signed: +yes / -no)
  position_fp?: string; // fixed-point, signed
  market_exposure?: number; // cents
  market_exposure_dollars?: string;
  total_traded?: number; // cents
  total_traded_dollars?: string;
  realized_pnl?: number; // cents
  realized_pnl_dollars?: string;
  fees_paid?: number; // cents
  fees_paid_dollars?: string;
  last_updated_ts?: string; // ISO
};

export type KalshiEventPositionWire = {
  event_ticker?: string;
  total_cost?: number;
  total_cost_dollars?: string;
  total_cost_shares?: number;
  total_cost_shares_fp?: string;
  event_exposure?: number;
  event_exposure_dollars?: string;
  realized_pnl?: number;
  realized_pnl_dollars?: string;
  fees_paid?: number;
  fees_paid_dollars?: string;
};

export type KalshiPositionsWire = {
  market_positions?: KalshiMarketPositionWire[];
  event_positions?: KalshiEventPositionWire[];
  cursor?: string;
};

export type KalshiFillWire = {
  fill_id?: string;
  trade_id?: string;
  order_id?: string;
  ticker?: string;
  market_ticker?: string; // legacy alias of ticker
  side?: "yes" | "no";
  action?: "buy" | "sell";
  count?: number;
  count_fp?: string;
  yes_price?: number; // cents
  yes_price_dollars?: string;
  no_price?: number;
  no_price_dollars?: string;
  is_taker?: boolean;
  fee_cost?: string; // dollars
  created_time?: string; // ISO
  ts?: number; // unix seconds
  subaccount_number?: number;
};

export type KalshiOrderWire = {
  order_id?: string;
  client_order_id?: string;
  ticker?: string;
  side?: "yes" | "no";
  action?: "buy" | "sell";
  type?: "limit" | "market";
  status?: "resting" | "canceled" | "executed" | "pending";
  yes_price?: number;
  yes_price_dollars?: string;
  no_price?: number;
  no_price_dollars?: string;
  initial_count?: number;
  fill_count?: number;
  remaining_count?: number;
  taker_fees?: number; // cents
  maker_fees?: number; // cents
  taker_fill_cost?: number; // cents
  maker_fill_cost?: number; // cents
  expiration_time?: string;
  created_time?: string;
  last_update_time?: string;
};

/** Standard Kalshi error envelope (all 4xx/5xx). */
export type KalshiErrorWire = {
  code?: string;
  message?: string;
  details?: string;
  service?: string;
};

// ── Normalized types (camelCase; the only shapes HQ/agents consume) ──

export type NormalizedBalance = {
  /** Available-to-trade balance, integer cents. */
  balanceCents: number | null;
  portfolioValueCents: number | null;
  updatedAtMs: number | null;
};

export type NormalizedPosition = {
  ticker: string;
  /** Signed contracts: +N = long N yes, -N = long N no (Kalshi convention). */
  position: number;
  fractional: boolean;
  exposureCents: number | null;
  realizedPnlCents: number | null;
  feesPaidCents: number | null;
  totalTradedCents: number | null;
  lastUpdatedAtMs: number | null;
};

export type NormalizedFill = {
  fillId: string | null;
  tradeId: string | null;
  orderId: string | null;
  ticker: string;
  side: "yes" | "no" | null;
  action: "buy" | "sell" | null;
  count: number;
  fractional: boolean;
  yesPriceCents: number | null;
  isTaker: boolean | null;
  feeCents: number | null;
  createdAtMs: number | null;
};

export type NormalizedOrder = {
  orderId: string;
  clientOrderId: string | null;
  ticker: string;
  side: "yes" | "no" | null;
  action: "buy" | "sell" | null;
  type: "limit" | "market" | null;
  status: string;
  yesPriceCents: number | null;
  initialCount: number | null;
  fillCount: number | null;
  remainingCount: number | null;
  takerFeesCents: number | null;
  makerFeesCents: number | null;
  createdAtMs: number | null;
  lastUpdateAtMs: number | null;
};

// ── Parsing helpers ──

/** "0.5600" → 56 (round-half-up). Null/invalid → null. */
export function dollarsToCents(dollars: string | undefined | null): number | null {
  if (dollars == null) return null;
  const n = Number(dollars);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** "10.00" → { value: 10, fractional: false }; "2.5" → fractional true. */
export function fpToCount(fp: string | undefined | null): { value: number; fractional: boolean } | null {
  if (fp == null) return null;
  const n = Number(fp);
  if (!Number.isFinite(n)) return null;
  return { value: n, fractional: !Number.isInteger(n) };
}

function isoToMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** Prefer legacy integer cents; fall back to dollar string. */
function cents(intCents: unknown, dollars: string | undefined): number | null {
  return intOrNull(intCents) ?? dollarsToCents(dollars);
}

// ── Parsers: wire → normalized (boundary lives here, like kalshi-book-parse) ──

export function normalizeBalance(wire: KalshiBalanceWire): NormalizedBalance {
  return {
    balanceCents: cents(wire.balance, wire.balance_dollars),
    portfolioValueCents: cents(wire.portfolio_value, wire.portfolio_value_dollars),
    updatedAtMs: typeof wire.updated_ts === "number" ? wire.updated_ts * 1000 : null,
  };
}

export function normalizeMarketPosition(w: KalshiMarketPositionWire): NormalizedPosition {
  const fp = fpToCount(w.position_fp);
  const legacy = intOrNull(w.position);
  return {
    ticker: w.ticker ?? "?",
    position: legacy ?? fp?.value ?? 0,
    fractional: legacy == null && fp?.fractional === true,
    exposureCents: cents(w.market_exposure, w.market_exposure_dollars),
    realizedPnlCents: cents(w.realized_pnl, w.realized_pnl_dollars),
    feesPaidCents: cents(w.fees_paid, w.fees_paid_dollars),
    totalTradedCents: cents(w.total_traded, w.total_traded_dollars),
    lastUpdatedAtMs: isoToMs(w.last_updated_ts),
  };
}

export function normalizeFill(w: KalshiFillWire): NormalizedFill {
  const fp = fpToCount(w.count_fp);
  const legacy = intOrNull(w.count);
  return {
    fillId: w.fill_id ?? null,
    tradeId: w.trade_id ?? null,
    orderId: w.order_id ?? null,
    ticker: w.ticker ?? w.market_ticker ?? "?",
    side: w.side === "yes" || w.side === "no" ? w.side : null,
    action: w.action === "buy" || w.action === "sell" ? w.action : null,
    count: legacy ?? fp?.value ?? 0,
    fractional: legacy == null && fp?.fractional === true,
    yesPriceCents: cents(w.yes_price, w.yes_price_dollars),
    isTaker: typeof w.is_taker === "boolean" ? w.is_taker : null,
    feeCents: dollarsToCents(w.fee_cost),
    createdAtMs: isoToMs(w.created_time) ?? (typeof w.ts === "number" ? w.ts * 1000 : null),
  };
}

export function normalizeOrder(w: KalshiOrderWire): NormalizedOrder {
  return {
    orderId: w.order_id ?? "?",
    clientOrderId: w.client_order_id ?? null,
    ticker: w.ticker ?? "?",
    side: w.side === "yes" || w.side === "no" ? w.side : null,
    action: w.action === "buy" || w.action === "sell" ? w.action : null,
    type: w.type === "limit" || w.type === "market" ? w.type : null,
    status: w.status ?? "unknown",
    yesPriceCents: cents(w.yes_price, w.yes_price_dollars),
    initialCount: intOrNull(w.initial_count),
    fillCount: intOrNull(w.fill_count),
    remainingCount: intOrNull(w.remaining_count),
    takerFeesCents: intOrNull(w.taker_fees),
    makerFeesCents: intOrNull(w.maker_fees),
    createdAtMs: isoToMs(w.created_time),
    lastUpdateAtMs: isoToMs(w.last_update_time),
  };
}

/** True when an order can still be cancelled / is working. */
export function isWorkingOrder(o: NormalizedOrder): boolean {
  return o.status === "resting" || o.status === "pending";
}
