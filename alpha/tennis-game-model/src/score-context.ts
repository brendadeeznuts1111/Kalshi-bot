/**
 * Map event-store live_scores + market YES side → score axes for p_model.
 */
import type { Database } from "bun:sqlite";
import { parseItfYesSideCode } from "../../../src/alpha/ticker-formats/itf.ts";
import {
  asCompetitorId,
  type CanonicalEventId,
  type KalshiMarketTicker,
  unbrand,
} from "../../../src/institutions/event-store/brands.ts";
import {
  getLiveScore,
  labelForCompetitor,
} from "../../../src/institutions/event-store/live-scores.ts";
import type { ScoreState } from "./score-model.ts";

export type { ScoreState };

export type ScoreContext = ScoreState & {
  pointsServer: number;
  pointsReturner: number;
  serverIsYes: boolean | null;
  bestOf: 3 | 5;
};

type EventPlayersRow = {
  player_a: string;
  player_b: string;
};

type MarketRow = {
  side_code: string;
  yes_side_label: string;
  competitor_id: string | null;
};

type LiveCompetitorRow = {
  competitor1_id: string | null;
  competitor2_id: string | null;
  server_competitor_id: string | null;
  points_home: number;
  points_away: number;
};

type CompetitorLabelRow = {
  competitor_id: string;
  label: string;
};

function loadEventPlayers(db: Database, eventId: CanonicalEventId): EventPlayersRow | null {
  return db
    .query(`SELECT player_a, player_b FROM events WHERE event_id = $id`)
    .get({ $id: unbrand(eventId) }) as EventPlayersRow | null;
}

function loadMarket(db: Database, ticker: KalshiMarketTicker): MarketRow | null {
  return db
    .query(
      `SELECT side_code, yes_side_label, competitor_id
       FROM markets WHERE ticker = $ticker`,
    )
    .get({ $ticker: unbrand(ticker) }) as MarketRow | null;
}

function loadLiveCompetitors(
  db: Database,
  eventId: CanonicalEventId,
): LiveCompetitorRow | null {
  return db
    .query(
      `SELECT competitor1_id, competitor2_id, server_competitor_id,
              points_home, points_away
       FROM live_scores WHERE event_id = $id`,
    )
    .get({ $id: unbrand(eventId) }) as LiveCompetitorRow | null;
}

function loadCompetitorLabels(
  db: Database,
  eventId: CanonicalEventId,
): CompetitorLabelRow[] {
  return db
    .query(
      `SELECT competitor_id, yes_side_label AS label
       FROM markets
       WHERE event_id = $id
         AND competitor_id IS NOT NULL AND competitor_id != ''
       GROUP BY competitor_id`,
    )
    .all({ $id: unbrand(eventId) }) as CompetitorLabelRow[];
}

function competitorIdForYesSide(
  db: Database,
  eventId: CanonicalEventId,
  yesSideCode: string,
  market: MarketRow,
): string | null {
  if (market.competitor_id) return market.competitor_id;
  const row = db
    .query(
      `SELECT competitor_id FROM markets
       WHERE event_id = $id AND side_code = $side_code
         AND competitor_id IS NOT NULL AND competitor_id != ''
       LIMIT 1`,
    )
    .get({ $id: unbrand(eventId), $side_code: yesSideCode }) as
    | { competitor_id: string }
    | null;
  return row?.competitor_id ?? null;
}

type ScoreSide = "home" | "away";

function yesScoreSide(
  db: Database,
  eventId: CanonicalEventId,
  yesSideCode: string,
  market: MarketRow,
  event: EventPlayersRow,
  liveIds: LiveCompetitorRow,
): ScoreSide | null {
  const yesCompetitorId = competitorIdForYesSide(db, eventId, yesSideCode, market);
  if (yesCompetitorId) {
    if (liveIds.competitor1_id === yesCompetitorId) return "home";
    if (liveIds.competitor2_id === yesCompetitorId) return "away";
  }

  const labels = loadCompetitorLabels(db, eventId).map((r) => ({
    competitorId: asCompetitorId(r.competitor_id),
    label: r.label,
  }));
  const c1Label = labelForCompetitor(
    labels,
    liveIds.competitor1_id ? asCompetitorId(liveIds.competitor1_id) : null,
  );
  const c2Label = labelForCompetitor(
    labels,
    liveIds.competitor2_id ? asCompetitorId(liveIds.competitor2_id) : null,
  );
  const yesLabel = market.yes_side_label;
  if (yesLabel && c1Label && yesLabel === c1Label) return "home";
  if (yesLabel && c2Label && yesLabel === c2Label) return "away";

  if (yesLabel === event.player_a || yesLabel === event.player_b) {
    if (yesLabel === c1Label) return "home";
    if (yesLabel === c2Label) return "away";
  }

  return null;
}

/**
 * Latest live score mapped to YES/NO set-game axes. Null when no live_scores row
 * or YES side cannot be aligned to the scoreboard — caller uses market mid prior only.
 */
export function loadScoreContext(
  db: Database,
  eventId: CanonicalEventId,
  ticker: KalshiMarketTicker,
): ScoreContext | null {
  const live = getLiveScore(db, eventId);
  if (!live) return null;

  const yesSideCode = parseItfYesSideCode(unbrand(ticker));
  if (!yesSideCode) return null;

  const market = loadMarket(db, ticker);
  const event = loadEventPlayers(db, eventId);
  const liveIds = loadLiveCompetitors(db, eventId);
  if (!market || !event || !liveIds) return null;
  if (market.side_code !== yesSideCode) return null;

  const side = yesScoreSide(db, eventId, yesSideCode, market, event, liveIds);
  if (!side) return null;

  const setsYes = side === "home" ? live.setsHome : live.setsAway;
  const setsNo = side === "home" ? live.setsAway : live.setsHome;

  let serverIsYes: boolean | null = null;
  if (liveIds.server_competitor_id) {
    if (liveIds.server_competitor_id === liveIds.competitor1_id) {
      serverIsYes = side === "home";
    } else if (liveIds.server_competitor_id === liveIds.competitor2_id) {
      serverIsYes = side === "away";
    }
  }

  const pointsHome = liveIds.points_home ?? live.pointsHome;
  const pointsAway = liveIds.points_away ?? live.pointsAway;
  const pointsServer = side === "home" ? pointsHome : pointsAway;
  const pointsReturner = side === "home" ? pointsAway : pointsHome;

  const bestOfRow = db
    .query(`SELECT best_of FROM events WHERE event_id = $id`)
    .get({ $id: unbrand(eventId) }) as { best_of: number | null } | null;
  const bestOf: 3 | 5 = (bestOfRow?.best_of ?? 3) >= 5 ? 5 : 3;

  return {
    setsYes,
    setsNo,
    gamesYes: side === "home" ? live.gamesHome : live.gamesAway,
    gamesNo: side === "home" ? live.gamesAway : live.gamesHome,
    pointsServer,
    pointsReturner,
    serverIsYes,
    bestOf,
    isLive: live.isLive,
  };
}
