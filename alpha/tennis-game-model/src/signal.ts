/**
 * Signal spec — self-model stub: p_model = market mid (no Odds API).
 * Full point/game model deferred until WS book volume ages.
 */
export type {
  BookLevel,
  BookSnapshot,
  Decision,
  SignalContext,
} from "../../../src/institutions/alpha-signal-types.ts";

import { midFromBookSnapshot } from "../../../src/bot/kalshi-book-parse.ts";
import type { BookSnapshot, Decision, SignalContext } from "../../../src/institutions/alpha-signal-types.ts";

export function midCents(book: BookSnapshot): number | null {
  return midFromBookSnapshot(book);
}

/** Honest placeholder — p_model = mid/100 until game-state model exists. */
export function buildSignalContext(input: {
  ticker: string;
  eventId: string;
  book: BookSnapshot;
}): SignalContext | null {
  const mid = midCents(input.book);
  if (mid == null) {
    return null;
  }
  const pModel = mid / 100;
  return {
    ticker: input.ticker,
    eventId: input.eventId,
    book: input.book,
    pModel,
    components: { market_mid_stub: pModel },
  };
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
  const mid = midCents(ctx.book);
  if (mid == null) {
    return { action: "skip", reason: "no tradeable mid — one-sided or invalid book" };
  }
  if (ctx.components.market_mid_stub == null) {
    return { action: "skip", reason: "stub p_model unavailable — mid missing at signal build" };
  }
  return {
    action: "trade",
    side: "yes",
    contracts,
    limitCents,
    reason: "market-mid stub passed structural checks (fee gate in execute)",
  };
}
