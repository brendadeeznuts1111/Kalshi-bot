// @see https://bun.com/docs/runtime/sqlite
/** Fail-soft live odds: empty map until matcher-v2 / Polymarket path lands on main. */
import type { CrossMarketOdds } from "./cross-market.ts";

export type LiveCrossMarketTarget = { ticker: string; playerA: string; playerB: string };

export async function fetchLiveCrossMarketOdds(
  _targets: readonly LiveCrossMarketTarget[] | readonly string[],
): Promise<Map<string, CrossMarketOdds>> {
  return new Map();
}
