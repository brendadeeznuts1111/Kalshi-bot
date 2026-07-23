/**
 * Self-model v2 — REAL prior from player strengths (Stadion ITF corpus) →
 * hold strength → match win probability. The pre-match "market echo" (opening
 * mid as p_model) is replaced: the model now carries independent information.
 *
 * model_kind: 0 = pre-match self-model prior (strengths → Markov);
 *             1 = live but unscored (fallback to prior);
 *             2 = live match Markov on self-model holds.
 * components.market_opening_prior stays as information only — v1 never blends
 * it into p_model (standalone calibration must be measurable first).
 */
import type { Database } from "bun:sqlite";
import {
  type CanonicalEventId,
  type KalshiMarketTicker,
  unbrand,
} from "../../../src/institutions/event-store/brands.ts";
import { openingPriorP } from "./opening-prior.ts";
import {
  inferHoldsFromMatchPrior,
  matchWinProbYes,
  type MatchScoreState,
} from "./match-model.ts";
import { resolveSelfPrior } from "./self-prior.ts";
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
  /** Evaluation clock (recv-clock epoch ms). Strengths use only resolutions
   *  known before this instant. Defaults to now (live path). */
  asOfMs?: number;
}): GameModelResult | null {
  const asOfMs = input.asOfMs ?? Date.now();
  const bestOf = input.score?.bestOf ?? loadBestOf(input.db, input.eventId);

  const prior = resolveSelfPrior({
    db: input.db,
    eventId: input.eventId,
    ticker: input.ticker,
    asOfMs,
    bestOf,
  });
  // Ambiguous identity → labeled skip (null). Never a guessed pair.
  if (prior.kind === "ambiguous") return null;

  const openingP =
    openingPriorP(input.db, input.ticker, input.eventId) ??
    (input.currentMidCents != null ? input.currentMidCents / 100 : null);

  const components: Record<string, number> = {
    self_prior: prior.pYes,
    players_known: prior.playersKnown,
    strength_yes: prior.strengthYes,
    strength_no: prior.strengthNo,
    hold_prob_yes: prior.holds.pHoldYes,
    hold_prob_no: prior.holds.pHoldNo,
  };
  if (openingP != null) components.market_opening_prior = openingP;

  if (!input.score?.isLive) {
    return {
      pModel: prior.pYes,
      components: { ...components, live: 0, model_kind: 0 },
    };
  }

  const state = toMatchState({ ...input.score, bestOf }, bestOf);
  if (!state) {
    return {
      pModel: prior.pYes,
      components: { ...components, live: 1, model_kind: 1 },
    };
  }

  const pModel = matchWinProbYes(state, prior.holds.pHoldYes, prior.holds.pHoldNo);
  return {
    pModel,
    components: {
      ...components,
      match_win_prob: pModel,
      live: 1,
      set_delta: input.score.setsYes - input.score.setsNo,
      game_delta: input.score.gamesYes - input.score.gamesNo,
      model_kind: 2,
    },
  };
}

/** Re-exported for callers that only need the market echo as a component. */
export { inferHoldsFromMatchPrior };
