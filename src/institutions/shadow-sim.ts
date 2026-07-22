export type BookLevel = { priceCents: number; size: number };

/** Walk depth best-price-first; record partial fills honestly. */
export function simulateFillVwap(
  levels: BookLevel[],
  contracts: number,
): { vwapFillCents: number | null; filledContracts: number } {
  let remaining = contracts;
  let cost = 0;
  let filled = 0;
  for (const level of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, level.size);
    cost += take * level.priceCents;
    filled += take;
    remaining -= take;
  }
  if (filled === 0) return { vwapFillCents: null, filledContracts: 0 };
  return { vwapFillCents: Math.round(cost / filled), filledContracts: filled };
}

/** 60s toxicity — shadow optimism vs live adverse selection. */
export function toxicityMovedAgainst(
  side: "yes" | "no",
  midAtFillCents: number,
  midAfterCents: number,
): boolean {
  if (side === "yes") return midAfterCents < midAtFillCents;
  return midAfterCents > midAtFillCents;
}
