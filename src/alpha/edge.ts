// @see https://kalshi.com/fee-schedule
/** Fee-aware edge — re-exports institution cent SSOT. */
export {
  FEE,
  MIN_CONTRACTS,
  DEFAULT_SLIPPAGE_MARGIN_CENTS,
  KALSHI_FEE_DOCS,
  feeCents,
  feePerContractCents,
  rawEdgeCents,
  passesThreshold,
  rawEdge,
  kalshiFee,
  computeEdgeBreakdown,
  wouldTrade,
} from "../institutions/kalshi-fees.ts";
export type { EdgeBreakdown } from "../institutions/kalshi-fees.ts";
