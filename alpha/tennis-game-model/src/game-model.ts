/**
 * Self-model v1 — opening prior → hold strength → match win probability.
 */
import type { Database } from "bun:sqlite";
import {
  type CanonicalEventId,
  type KalshiMarketTicker,
  unbrand,
} from "../../../src/institutions/event-store/brands.ts";
import { openingPriorP } from "./opening-prior.ts";
import {
  inferSymmetricHoldFromMatchPrior,
  matchWinProbYes,
  type MatchScoreState,
} from "./match-model.ts";
import type { ScoreContext } from "./score-context.ts";

export type GameModelResult = {
  pModel: number;
  components: Record<string, number>;
};

function loadBestOf(db: Database, eventId: CanonicalEventId): 3 | 5 {
  const row = db
    .query(`SELECT best_of FROM events WHERE event_id = $id`)
    .get({ $id: unbrand(eventId) }) as { best_of: number | null } | null;
  const bo = row?.best_of ?? 3;
  return bo >= 5 ? 5 : 3;
}

function toMatchState(score: ScoreContext, bestOf: 3 | 5): MatchScoreState | null {
  if (score.serverIsYes == null) return null;
  const pointsYes = score.serverIsYes ? score.pointsServer : score.pointsReturner;
  const pointsNo = score.serverIsYes ? score.pointsReturner : score.pointsServer;
  return {
    setsYes: score.setsYes,
    setsNo: score.setsNo,
    gamesYes: score.gamesYes,
    gamesNo: score.gamesNo,
    pointsServer: score.serverIsYes ? pointsYes : pointsNo,
    pointsReturner: score.serverIsYes ? pointsNo : pointsYes,
    serverIsYes: score.serverIsYes,
    bestOf,
  };
}

export function buildGameModelP(input: {
  db: Database;
  ticker: KalshiMarketTicker;
  eventId: CanonicalEventId;
  currentMidCents: number | null;
  score: ScoreContext | null;
}): GameModelResult | null {
  const openingP =
    openingPriorP(input.db, input.ticker, input.eventId) ??
    (input.currentMidCents != null ? input.currentMidCents / 100 : null);
  if (openingP == null) return null;

  const bestOf = input.score?.bestOf ?? loadBestOf(input.db, input.eventId);
  const pHold = inferSymmetricHoldFromMatchPrior(openingP, bestOf);

  if (!input.score?.isLive) {
    return {
      pModel: openingP,
      components: {
        market_opening_prior: openingP,
        hold_prob_symmetric: pHold,
        live: 0,
        model_kind: 0,
      },
    };
  }

  const state = toMatchState({ ...input.score, bestOf }, bestOf);
  if (!state) {
    return {
      pModel: openingP,
      components: {
        market_opening_prior: openingP,
        hold_prob_symmetric: pHold,
        live: 1,
        model_kind: 1,
      },
    };
  }

  const pModel = matchWinProbYes(state, pHold, pHold);
  return {
    pModel,
    components: {
      market_opening_prior: openingP,
      hold_prob_symmetric: pHold,
      match_win_prob: pModel,
      live: 1,
      set_delta: input.score.setsYes - input.score.setsNo,
      game_delta: input.score.gamesYes - input.score.gamesNo,
      model_kind: 2,
    },
  };
}
