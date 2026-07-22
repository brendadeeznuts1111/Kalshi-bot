/**
 * Signal spec — self-model: p_model = market mid prior, live score logit adjustment.
 */
export type {
  BookLevel,
  BookSnapshot,
  Decision,
  SignalContext,
} from "../../../src/institutions/alpha-signal-types.ts";

import { midFromBookSnapshot } from "../../../src/bot/kalshi-book-parse.ts";
import type { BookSnapshot, Decision, SignalContext } from "../../../src/institutions/alpha-signal-types.ts";
import type { ScoreContext } from "./score-context.ts";
import { scoreAdjustedPModel } from "./score-model.ts";

export function midCents(book: BookSnapshot): number | null {
  return midFromBookSnapshot(book);
}

export async function buildSignalContext(input: {
  ticker: string;
  eventId: string;
  book: BookSnapshot;
  scoreContext?: ScoreContext | null;
}): Promise<SignalContext | null> {
  const mid = midCents(input.book);
  if (mid == null) {
    return null;
  }

  const priorP = mid / 100;
  const score = input.scoreContext ?? null;
  const adjusted = score
    ? scoreAdjustedPModel({
        priorP,
        setsYes: score.setsYes,
        setsNo: score.setsNo,
        gamesYes: score.gamesYes,
        gamesNo: score.gamesNo,
        isLive: score.isLive,
      })
    : scoreAdjustedPModel({
        priorP,
        setsYes: 0,
        setsNo: 0,
        gamesYes: 0,
        gamesNo: 0,
        isLive: false,
      });

  const components: Record<string, number> = {
    market_mid_prior: priorP,
    score_adjusted: adjusted.pModel,
    live: score?.isLive ? 1 : 0,
  };
  if (score?.isLive) {
    components.set_delta = adjusted.setDelta;
    components.game_delta = adjusted.gameDelta;
  }

  return {
    ticker: input.ticker,
    eventId: input.eventId,
    book: input.book,
    pModel: adjusted.pModel,
    components,
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
  if (ctx.components.market_mid_prior == null) {
    return { action: "skip", reason: "p_model unavailable — mid missing at signal build" };
  }

  const isLive = ctx.components.live === 1;
  if (!isLive && (mid > 85 || mid < 15)) {
    return {
      action: "skip",
      reason: "pre-match deep tail (>85¢ or <15¢) — hypothesis scope is mid-band + underdog",
    };
  }

  return {
    action: "trade",
    side: "yes",
    contracts,
    limitCents,
    reason: isLive
      ? "live score-adjusted p_model passed structural checks (fee gate in execute)"
      : "market-mid prior passed structural checks (fee gate in execute)",
  };
}
