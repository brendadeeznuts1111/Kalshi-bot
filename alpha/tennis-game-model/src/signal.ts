/**
 * Signal spec — self-model v1: opening prior + match Markov in-play.
 */
export type {
  BookLevel,
  BookSnapshot,
  Decision,
  SignalContext,
} from "../../../src/institutions/alpha-signal-types.ts";

import type { Database } from "bun:sqlite";
import { midFromBookSnapshot } from "../../../src/bot/kalshi-book-parse.ts";
import type { BookSnapshot, Decision, SignalContext } from "../../../src/institutions/alpha-signal-types.ts";
import {
  asCanonicalEventId,
  asKalshiMarketTicker,
  type CanonicalEventId,
  type KalshiMarketTicker,
} from "../../../src/institutions/event-store/brands.ts";
import { buildGameModelP } from "./game-model.ts";
import type { ScoreContext } from "./score-context.ts";

export function midCents(book: BookSnapshot): number | null {
  return midFromBookSnapshot(book);
}

export async function buildSignalContext(input: {
  db: Database;
  ticker: string;
  eventId: string;
  book: BookSnapshot;
  scoreContext?: ScoreContext | null;
}): Promise<SignalContext | null> {
  const mid = midCents(input.book);
  if (mid == null) {
    return null;
  }

  const ticker = asKalshiMarketTicker(input.ticker);
  const eventId = asCanonicalEventId(input.eventId);

  const model = buildGameModelP({
    db: input.db,
    ticker,
    eventId,
    currentMidCents: mid,
    score: input.scoreContext ?? null,
  });
  if (!model) {
    return null;
  }

  return {
    ticker: input.ticker,
    eventId: input.eventId,
    book: input.book,
    pModel: model.pModel,
    components: {
      ...model.components,
      market_mid_current: mid / 100,
    },
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
  if (ctx.components.market_opening_prior == null && ctx.components.market_mid_current == null) {
    return { action: "skip", reason: "p_model unavailable — no opening prior or mid" };
  }

  const isLive = ctx.components.live === 1;
  if (!isLive && (mid > 85 || mid < 15)) {
    return {
      action: "skip",
      reason: "pre-match deep tail (>85¢ or <15¢) — hypothesis scope is mid-band + underdog",
    };
  }

  const modelKind = ctx.components.model_kind ?? 0;
  const modelLabel =
    modelKind === 2 ? "match_markov_v1" : modelKind === 1 ? "opening_fallback" : "opening_prior";
  return {
    action: "trade",
    side: "yes",
    contracts,
    limitCents,
    reason: isLive
      ? `match model (${modelLabel}) passed structural checks (fee gate in execute)`
      : "opening prior passed structural checks (fee gate in execute)",
  };
}
