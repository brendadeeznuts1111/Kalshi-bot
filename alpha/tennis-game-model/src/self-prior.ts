/**
 * Self-model pre-match prior — player strengths → FIXED Markov recursion.
 *
 * Identity path (reuses the event-store axes the bridge/score-context already
 * own): events.player_a / player_b are full names in BOTH the Stadion and
 * Kalshi namespaces; markets.yes_side_label names the YES player. Names are
 * normalized (case/accents) before matching. Ambiguity hard-fails:
 *   - yes_side_label matches neither player_a nor player_b, or
 *   - a name collides across distinct corpus players
 * → return { kind: "ambiguous" } — the caller skips the signal, labeled.
 * Doctrine: never invent a pair.
 *
 * v1 blending policy: PURE self-model prior (doctrine: self-model vs market
 * mid). The market opening mid stays available as a component for later
 * blending, but is NOT blended here — graduation needs standalone calibration.
 */
import type { Database } from "bun:sqlite";
import {
  type CanonicalEventId,
  type KalshiMarketTicker,
  unbrand,
} from "../../../src/institutions/event-store/brands.ts";
import { clampProb, inferHoldsFromMatchPrior, type HoldPair } from "./match-model.ts";
import {
  isAmbiguousName,
  matchupPriorP,
  normalizePlayerName,
  strengthFor,
} from "./player-strengths.ts";

export type SelfPrior =
  | {
      kind: "ok";
      /** P(YES wins the match) from strengths alone. */
      pYes: number;
      holds: HoldPair;
      /** 0 = both unknown (no independent information), 1, 2. */
      playersKnown: 0 | 1 | 2;
      strengthYes: number;
      strengthNo: number;
    }
  | { kind: "ambiguous"; reason: string };

type EventPlayersRow = { player_a: string; player_b: string };

export function resolveSelfPrior(input: {
  db: Database;
  eventId: CanonicalEventId;
  ticker: KalshiMarketTicker;
  asOfMs: number;
  bestOf: 3 | 5;
  surface?: string;
}): SelfPrior {
  const { db } = input;
  const event = db
    .query(`SELECT player_a, player_b FROM events WHERE event_id = $id`)
    .get({ $id: unbrand(input.eventId) }) as EventPlayersRow | null;
  const market = db
    .query(`SELECT yes_side_label FROM markets WHERE ticker = $t`)
    .get({ $t: unbrand(input.ticker) }) as { yes_side_label: string } | null;
  if (!event || !market || !market.yes_side_label) {
    return { kind: "ambiguous", reason: "missing event players or YES label" };
  }

  const yesKey = normalizePlayerName(market.yes_side_label);
  const aKey = normalizePlayerName(event.player_a);
  const bKey = normalizePlayerName(event.player_b);
  if (aKey === bKey) {
    return { kind: "ambiguous", reason: "event players normalize to same key" };
  }
  let noName: string;
  if (yesKey === aKey) noName = event.player_b;
  else if (yesKey === bKey) noName = event.player_a;
  else {
    return {
      kind: "ambiguous",
      reason: `YES label '${market.yes_side_label}' matches neither event player`,
    };
  }

  const opts = { asOfMs: input.asOfMs, surface: input.surface };
  if (isAmbiguousName(db, market.yes_side_label, opts) || isAmbiguousName(db, noName, opts)) {
    return { kind: "ambiguous", reason: "player name collides across corpus identities" };
  }

  const sYes = strengthFor(db, market.yes_side_label, opts);
  const sNo = strengthFor(db, noName, opts);
  const playersKnown = ((sYes.known ? 1 : 0) + (sNo.known ? 1 : 0)) as 0 | 1 | 2;
  const pYes = clampProb(matchupPriorP(sYes.strength, sNo.strength));
  const holds = inferHoldsFromMatchPrior(pYes, input.bestOf);
  return {
    kind: "ok",
    pYes,
    holds,
    playersKnown,
    strengthYes: sYes.strength,
    strengthNo: sNo.strength,
  };
}
