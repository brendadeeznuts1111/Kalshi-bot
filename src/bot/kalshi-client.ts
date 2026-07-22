// @see https://docs.kalshi.com/api-reference
// @see https://kalshi.com/fee-schedule
/**
 * Shared Kalshi execution client — lift auth + orders from MM/arb shortlist.
 * Tenants import this; harness research code must not import alpha programs.
 */
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";
export type KalshiOrderSide = "yes" | "no";

export type KalshiOrderRequest = {
  ticker: string;
  side: KalshiOrderSide;
  count: number;
  /** Limit price in cents (1–99). */
  priceCents: number;
  dryRun: boolean;
};

export type KalshiOrderResult = {
  orderId: string;
  dryRun: boolean;
};

/** Placeholder until lifted client is wired — execute.ts calls this behind --live. */
export async function placeOrder(request: KalshiOrderRequest): Promise<KalshiOrderResult> {
  if (request.dryRun) {
    return { orderId: `dry-${request.ticker}-${Date.now()}`, dryRun: true };
  }
  throw new Error(
    `Live Kalshi client not wired — lift from market-making shortlist before --live (API: ${OFFICIAL_URLS.kalshi.tradeApiDocs})`,
  );
}
