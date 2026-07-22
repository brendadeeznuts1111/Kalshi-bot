/**
 * Kalshi milestones + live_data (public market-data API).
 * Tennis details expose competitor UUIDs aligned with custom_strike.tennis_competitor.
 *
 * @see https://docs.kalshi.com/api-reference/milestone/get-milestones
 * @see https://docs.kalshi.com/api-reference/live-data/get-live-data
 * @see https://docs.kalshi.com/getting_started/targets_and_milestones
 */
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";
import type { KalshiFetchImpl } from "./kalshi-events-api.ts";

/** Re-export for pollers (live-scores, etc.) that inject fetch. */
export type { KalshiFetchImpl };

export type KalshiMilestoneWire = {
  id: string;
  type: string;
  title: string;
  startDate: string | null;
  primaryEventTickers: string[];
  relatedEventTickers: string[];
  /** From milestone.details — same UUID family as tennis_competitor. */
  firstCompetitorId: string | null;
  secondCompetitorId: string | null;
  mainGameEventTicker: string | null;
  rawDetails: Record<string, unknown>;
};

export type KalshiLiveDataWire = {
  milestoneId: string;
  type: string;
  status: string;
  matchStatus: string;
  competitor1Id: string | null;
  competitor2Id: string | null;
  setsHome: number;
  setsAway: number;
  gamesHome: number;
  gamesAway: number;
  pointsHome: number;
  pointsAway: number;
  /** Competitor UUID currently serving, or null. */
  serverCompetitorId: string | null;
  /** 1 = competitor1, 2 = competitor2, 0 = unknown. */
  serverSide: 0 | 1 | 2;
  winnerCompetitorId: string | null;
  completedRounds: number;
  details: Record<string, unknown>;
};

function resolveBaseUrl(explicit?: string): string {
  return (
    explicit?.replace(/\/$/, "") ??
    Bun.env.KALSHI_API_BASE?.trim().replace(/\/$/, "") ??
    OFFICIAL_URLS.kalshi.tradeApiV2Base
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function asInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return 0;
}

function gamesFromRoundScores(scores: unknown, completedRounds: number): number {
  if (!Array.isArray(scores)) return 0;
  const row = scores[completedRounds];
  if (!isRecord(row)) return 0;
  return asInt(row.score);
}

/** Wire boundary: GET /milestones?related_event_ticker=… */
export function parseKalshiMilestonesWire(wire: unknown): KalshiMilestoneWire[] {
  if (!isRecord(wire) || !Array.isArray(wire.milestones)) return [];
  const out: KalshiMilestoneWire[] = [];
  for (const raw of wire.milestones) {
    if (!isRecord(raw)) continue;
    const id = asString(raw.id);
    if (!id) continue;
    const details = isRecord(raw.details) ? raw.details : {};
    const primary = Array.isArray(raw.primary_event_tickers)
      ? raw.primary_event_tickers.filter((t): t is string => typeof t === "string")
      : [];
    const related = Array.isArray(raw.related_event_tickers)
      ? raw.related_event_tickers.filter((t): t is string => typeof t === "string")
      : [];
    out.push({
      id,
      type: asString(raw.type) ?? "",
      title: asString(raw.title) ?? "",
      startDate: asString(raw.start_date),
      primaryEventTickers: primary,
      relatedEventTickers: related,
      firstCompetitorId: asString(details.first_competitor_id),
      secondCompetitorId: asString(details.second_competitor_id),
      mainGameEventTicker: asString(details.main_game_event_ticker),
      rawDetails: details,
    });
  }
  return out;
}

/** Wire boundary: GET /live_data/milestone/{id} */
export function parseKalshiLiveDataWire(wire: unknown): KalshiLiveDataWire | null {
  if (!isRecord(wire) || !isRecord(wire.live_data)) return null;
  const ld = wire.live_data;
  const details = isRecord(ld.details) ? ld.details : {};
  const milestoneId = asString(ld.milestone_id);
  if (!milestoneId) return null;
  const competitor1Id = asString(details.competitor1_id);
  const competitor2Id = asString(details.competitor2_id);
  const completedRounds = asInt(details.completed_rounds);
  const serverRaw = asString(details.server);
  let serverSide: 0 | 1 | 2 = 0;
  if (serverRaw && competitor1Id && serverRaw === competitor1Id) serverSide = 1;
  else if (serverRaw && competitor2Id && serverRaw === competitor2Id) serverSide = 2;

  return {
    milestoneId,
    type: asString(ld.type) ?? "",
    status: asString(details.status) ?? "",
    matchStatus: asString(details.match_status) ?? "",
    competitor1Id,
    competitor2Id,
    setsHome: asInt(details.competitor1_overall_score),
    setsAway: asInt(details.competitor2_overall_score),
    gamesHome: gamesFromRoundScores(details.competitor1_round_scores, completedRounds),
    gamesAway: gamesFromRoundScores(details.competitor2_round_scores, completedRounds),
    pointsHome: asInt(details.competitor1_current_round_score),
    pointsAway: asInt(details.competitor2_current_round_score),
    serverCompetitorId: serverRaw,
    serverSide,
    winnerCompetitorId: asString(details.winner),
    completedRounds,
    details,
  };
}

export function isLiveScoreStatus(status: string, score: Pick<KalshiLiveDataWire, "setsHome" | "setsAway" | "gamesHome" | "gamesAway" | "pointsHome" | "pointsAway" | "serverCompetitorId">): boolean {
  const s = status.trim().toLowerCase();
  if (!s || s === "not_started") {
    // Early start: points already moving while status lags.
    return (
      score.setsHome + score.setsAway + score.gamesHome + score.gamesAway + score.pointsHome + score.pointsAway >
        0 || Boolean(score.serverCompetitorId)
    );
  }
  if (s === "ended" || s === "closed" || s === "final" || s === "cancelled") return false;
  return true;
}

export async function fetchKalshiMilestonesForEvent(
  eventTicker: string,
  options: { baseUrl?: string; fetchImpl?: KalshiFetchImpl } = {},
): Promise<KalshiMilestoneWire[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const q = new URLSearchParams({
    related_event_ticker: eventTicker,
    limit: "100",
  });
  const url = `${base}/milestones?${q}`;
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Kalshi milestones ${eventTicker}: ${res.status} ${res.statusText}`);
  return parseKalshiMilestonesWire(await res.json());
}

export async function fetchKalshiLiveData(
  milestoneId: string,
  options: { baseUrl?: string; fetchImpl?: KalshiFetchImpl } = {},
): Promise<{ data: KalshiLiveDataWire | null; sourceUrl: string; fetchedTs: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = resolveBaseUrl(options.baseUrl);
  const sourceUrl = `${base}/live_data/milestone/${encodeURIComponent(milestoneId)}`;
  const res = await fetchImpl(sourceUrl, { headers: { Accept: "application/json" } });
  const fetchedTs = Date.now();
  if (res.status === 404) return { data: null, sourceUrl, fetchedTs };
  if (!res.ok) throw new Error(`Kalshi live_data ${milestoneId}: ${res.status} ${res.statusText}`);
  return { data: parseKalshiLiveDataWire(await res.json()), sourceUrl, fetchedTs };
}

/** Prefer tennis_* milestone; else first related. */
export function pickTennisMilestone(milestones: KalshiMilestoneWire[]): KalshiMilestoneWire | null {
  if (!milestones.length) return null;
  return (
    milestones.find((m) => /tennis/i.test(m.type)) ??
    milestones.find((m) => m.primaryEventTickers.length > 0) ??
    milestones[0]!
  );
}
