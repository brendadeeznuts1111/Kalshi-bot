// @see https://kalshi.com/fee-schedule
// @see https://docs.kalshi.com/getting_started/fee_rounding
/**
 * Kalshi fee model — cents-first, exchange `ceil` rounding.
 *
 * Structure: feeCents = ceil(rate × contracts × P × (1 − P) × 100)
 * Edge (cents): rawEdgeCents = pModel×100 − priceCents
 * Trade iff rawEdgeCents > feePerContractCents + slippageMarginCents
 *
 * Official: {@link OFFICIAL_URLS.kalshi.feeSchedule}
 */
import { OFFICIAL_URLS } from "./official-urls.ts";

/** Rates: verify against Kalshi's current fee schedule before first live run. */
export const FEE = {
  takerRate: 0.07,
  makerRate: 0.0175,
} as const;

/** Sub-threshold sizes have structurally worse fee drag (ceil is regressive). */
export const MIN_CONTRACTS = 5;

export const DEFAULT_SLIPPAGE_MARGIN_CENTS = 2;

export const KALSHI_FEE_DOCS = OFFICIAL_URLS.kalshi.feeSchedule;

/** Total taker fee in cents — exchange round-up to next cent. */
export function feeCents(rate: number, contracts: number, priceCents: number): number {
  if (contracts <= 0 || priceCents <= 0 || priceCents >= 100) return 0;
  const p = priceCents / 100;
  return Math.ceil(rate * contracts * p * (1 - p) * 100);
}

export function feePerContractCents(
  rate: number,
  contracts: number,
  priceCents: number,
): number {
  if (contracts <= 0) return 0;
  return feeCents(rate, contracts, priceCents) / contracts;
}

/** Model edge in cents — never subtract fees inside this value. */
export function rawEdgeCents(pModel: number, priceCents: number): number {
  return Math.round(pModel * 100 - priceCents);
}

export function passesThreshold(
  pModel: number,
  priceCents: number,
  contracts: number,
  slippageMarginCents = DEFAULT_SLIPPAGE_MARGIN_CENTS,
  rate = FEE.takerRate,
): boolean {
  if (contracts < MIN_CONTRACTS) return false;
  return (
    rawEdgeCents(pModel, priceCents) >
    feePerContractCents(rate, contracts, priceCents) + slippageMarginCents
  );
}

/** Dollar helpers for baseline alpha (`src/alpha/edge.ts`). */
export function rawEdge(pModel: number, kalshiPrice: number): number {
  return rawEdgeCents(pModel, Math.round(kalshiPrice * 100)) / 100;
}

export function kalshiFee(price: number, contracts = 1): number {
  return feePerContractCents(FEE.takerRate, contracts, Math.round(price * 100)) / 100;
}

export const takerFeePerContract = kalshiFee;

export function computeEdgeBreakdown(
  pModel: number,
  kalshiPrice: number,
  slippageMargin = DEFAULT_SLIPPAGE_MARGIN_CENTS / 100,
  contracts = MIN_CONTRACTS,
): {
  pModel: number;
  kalshiPrice: number;
  rawEdge: number;
  fees: number;
  feesRounded: number;
  slippageMargin: number;
  wouldTrade: boolean;
} {
  const priceCents = Math.round(kalshiPrice * 100);
  const feesRounded = feeCents(FEE.takerRate, contracts, priceCents) / 100;
  const fees = feePerContractCents(FEE.takerRate, contracts, priceCents) / 100;
  const edge = rawEdge(pModel, kalshiPrice);
  return {
    pModel,
    kalshiPrice,
    rawEdge: edge,
    fees,
    feesRounded,
    slippageMargin,
    wouldTrade: passesThreshold(
      pModel,
      priceCents,
      contracts,
      Math.round(slippageMargin * 100),
    ),
  };
}

export type EdgeBreakdown = ReturnType<typeof computeEdgeBreakdown>;

export function wouldTrade(
  pModel: number,
  kalshiPrice: number,
  slippageMargin = DEFAULT_SLIPPAGE_MARGIN_CENTS / 100,
  contracts = MIN_CONTRACTS,
): boolean {
  return passesThreshold(
    pModel,
    Math.round(kalshiPrice * 100),
    contracts,
    Math.round(slippageMargin * 100),
  );
}

/** @deprecated use FEE.takerRate */
export const TAKER_FEE_COEFFICIENT = FEE.takerRate;
/** @deprecated use FEE.makerRate */
export const MAKER_FEE_COEFFICIENT = FEE.makerRate;
/** @deprecated use DEFAULT_SLIPPAGE_MARGIN_CENTS / 100 */
export const DEFAULT_SLIPPAGE_MARGIN = DEFAULT_SLIPPAGE_MARGIN_CENTS / 100;

export function takerFeeRoundedDollars(price: number, contracts = 1): number {
  return feeCents(FEE.takerRate, contracts, Math.round(price * 100)) / 100;
}
