/**
 * Signal spec — mandatory components; every skip has reason.
 *
 * Baseline wiring: Pinnacle novig only (no proprietary alpha).
 * Institutions: buildPinnacleSignalContext in src/alpha/signal-context.ts
 */
export type {
  BookLevel,
  BookSnapshot,
  Decision,
  SignalContext,
} from "../../../src/institutions/alpha-signal-types.ts";

import type { OddsEvent } from "../../../src/alpha/odds-types.ts";
import { buildPinnacleSignalContext } from "../../../src/alpha/signal-context.ts";
import type { BookSnapshot, Decision, SignalContext } from "../../../src/institutions/alpha-signal-types.ts";

let oddsEvents: OddsEvent[] | null = null;

/** run-once.ts injects feed snapshot before execute. */
export function setOddsEvents(events: OddsEvent[]): void {
  oddsEvents = events;
}

export function midCents(book: BookSnapshot): number | null {
  if (book.crossed) return null;
  const bestBid = book.bids[0]?.priceCents;
  const bestAsk = book.asks[0]?.priceCents;
  if (bestBid == null || bestAsk == null) return null;
  return Math.round((bestBid + bestAsk) / 2);
}

/** Fetch Pinnacle → map ticker → p_model = novig prob for YES side. */
export async function buildSignalContext(input: {
  ticker: string;
  eventId: string;
  book: BookSnapshot;
  kalshiPriceCents?: number;
}): Promise<SignalContext | null> {
  if (!oddsEvents?.length) {
    return null;
  }
  return buildPinnacleSignalContext({
    kalshiTicker: input.ticker,
    book: input.book,
    events: oddsEvents,
    kalshiPriceCents: input.kalshiPriceCents,
    side: "yes",
  });
}

export function decide(ctx: SignalContext, minContracts: number): Decision {
  if (ctx.book.crossed) {
    return {
      action: "skip",
      reason: "crossed book — yesBid+noBid>100 (transient anomaly)",
    };
  }
  const contracts = ctx.contracts ?? minContracts;
  if (!ctx.components || Object.keys(ctx.components).length === 0) {
    return { action: "skip", reason: "missing components breakdown" };
  }
  if (contracts < minContracts) {
    return {
      action: "skip",
      reason: `below MIN_CONTRACTS (${contracts} < ${minContracts}) — fee ceil is regressive at small size`,
    };
  }
  const limitCents = ctx.book.asks[0]?.priceCents ?? null;
  if (limitCents == null) {
    return { action: "skip", reason: "book too thin — empty ask side" };
  }
  return {
    action: "trade",
    side: "yes",
    contracts,
    limitCents,
    reason: "pinnacle-novig edge passed structural checks (fee gate in execute)",
  };
}
