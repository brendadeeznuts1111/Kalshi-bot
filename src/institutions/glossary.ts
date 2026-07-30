/**
 * glossary.ts — single source of truth for domain short codes, unit
 * conventions, and UI tooltip copy. docs/GLOSSARY.md is generated from this
 * module; do not fork definitions into views.
 *
 * Convention:
 *   - Short codes are 3–5 uppercase letters, stable forever (append-only).
 *   - Money fields end in `Cents` (integer) or `Dollars` (fixed-point string).
 *   - Times end in `AtMs` (epoch millis). Wire `*_ts` is unix SECONDS.
 */

// ── Ledger / entity short codes ──

export const CODES = {
  // Money movement (Kalshi has no programmatic deposit/withdraw — DEP/WDL
  // appear only in OUR reconciliation records after bank-rail transfers)
  DEP: "deposit — funds in via Kalshi web/bank rails; reconciled, never API-initiated",
  WDL: "withdrawal — funds out via Kalshi web/bank rails; reconciled, never API-initiated",
  TRF: "internal transfer between subaccounts",

  // Trading entities
  ORD: "order — working intent; status resting|pending|executed|canceled",
  FILL: "fill — executed quantity against an order; has is_taker + fee_cost",
  POS: "position — signed contracts per market (+yes / −no)",
  BAL: "balance — available-to-trade cents; portfolio_value is separate",
  FEE: "fee — taker or maker, cents (taker_fees / maker_fees / fee_cost)",
  SETL: "settlement — market resolution payout",

  // Market data
  BOOK: "orderbook snapshot — bids/asks in yes-cents, integer levels",
  TICK: "price tick from ingest (polymarket/market_data agent)",
  EVT: "canonical event (kalshi:EVENT-TICKER in event store)",
  MILE: "Kalshi milestone — groups related event tickers",

  // Pipeline
  RUN: "research run — one discovery+score sweep, id = UTC timestamp",
  PROG: "alpha program — alpha/*/program.json, status shadow|pilot|live",
  SHDW: "shadow signal — simulated decision, hash-chained in shadow-log.jsonl",
  CAL: "calibration run — calibration/artifacts/<ts>",
} as const;

export type ShortCode = keyof typeof CODES;

// ── Unit conventions ──

export const UNITS = {
  cents: "integer cents, 1–99 for prices; canonical money unit everywhere",
  dollarsFp: "fixed-point dollar string e.g. \"0.5600\" — wire only, parse via dollarsToCents",
  countFp: "fixed-point contract string e.g. \"10.00\" — fractional flagged, not orderable",
  atMs: "epoch milliseconds — canonical time unit (suffix AtMs)",
  unixSec: "unix seconds — wire only (updated_ts, ts); multiply by 1000 at boundary",
} as const;

// ── UI tooltips (HQ renders these; keyed by canonical field) ──

export const TOOLTIPS = {
  balanceCents: "Available-to-trade cash. Does not include value locked in open positions.",
  portfolioValueCents: "Current mark value of all held positions, separate from cash balance.",
  position: "Signed contracts: positive = long YES, negative = long NO (Kalshi convention).",
  exposureCents: "Cash at risk in this market at current marks.",
  realizedPnlCents: "Locked-in profit/loss from closed trades in this market.",
  feesPaidCents: "Total exchange fees paid in this market, all time.",
  yesPriceCents: "Limit price for YES contracts, 1–99¢. NO price = 100 − yes.",
  remainingCount: "Contracts still working on the book (not yet filled or canceled).",
  fillCount: "Contracts already executed from this order.",
  isTaker: "True = crossed the spread (taker fee); false = rested on book (maker fee, lower).",
  feeCents: "Exchange fee on this fill. Maker < taker — postOnly orders target maker fees.",
  postOnly: "Maker-first: order rests on book or is rejected; never crosses the spread.",
  dryRun: "Simulated order — no funds move, no API write. Live requires explicit opt-in.",
  mid: "Midpoint of best yes-bid and yes-ask. Untradeable reference price.",
  spreadCents: "Best ask − best bid. Wide spreads = poor liquidity; prefer postOnly.",
  crossed: "Transient book state (yesBid + noBid > 100). Do not treat mid as tradeable.",
  shadowMinSignals: "Gate: minimum shadow signals before a program may graduate to pilot.",
  killBrierDriftPct: "Gate: kill program if Brier score drifts this % above baseline.",
  graduationMinRealizedEdgeCentsPerFill: "Gate: realized edge per fill needed for pilot→live.",
  playerProfiles:
    "Derived from event-store player_profiles (SSOT): appearances, W–L, surfaces, avgKalshiVolumeFp. Rebuild: bun run tennis:profiles:build. Meta: docs/PLAYER_PROFILES_META.md",
  avgKalshiVolumeFp:
    "Mean resolved Kalshi contract volume over trading appearances (player_profiles.avg_kalshi_volume_fp). Not poly; not live board volume24h.",
  lastSeenAtMs:
    "Epoch millis of latest event start for this player (player_profiles.last_seen_ts). Capped ≤ now. Event-store ms, not Kalshi wire seconds.",
  profilesSource:
    "warehouse = rows from event-store; seed = unavailable / fixture path (no live profiles).",
} as const;

export type TooltipKey = keyof typeof TOOLTIPS;
