/**
 * Tennis event board — pulls every open tennis match event from Kalshi's
 * events API (with nested markets), normalizes names/prices into a view model
 * for the HQ Events tab, and caches briefly so dashboard polling doesn't
 * turn into an upstream burst.
 *
 * Money in = Kalshi wire strings (`*_dollars`, `*_fp`); money out = cents ints.
 */
// @see https://docs.kalshi.com/api-reference/market/get-markets
// @see https://docs.kalshi.com/api-reference/events/get-events
import {
  competitorIdForMarket,
  fetchAllKalshiMarkets,
  type KalshiEventWire,
  type KalshiMarketWire,
} from "../bot/kalshi-events-api.ts";
import {
  asKalshiEventTicker,
  unbrand,
  type SeriesTicker,
} from "../institutions/event-store/brands.ts";
import {
  SPORT,
  type MarketKind,
  type SportKey,
} from "../institutions/market-registry/brands.ts";
import {
  kalshiBindingForSeries,
  kalshiIdentityFieldForSeries,
  kalshiInventorySeriesForSport,
  kalshiReconciliationSeriesForSport,
  kalshiSportForSeries,
  kalshiTradeSeriesForSport,
} from "../institutions/market-registry/registry.ts";
import type {
  EventType,
  ParticipantFormat,
} from "../institutions/market-registry/types.ts";
import {
  cityFromTournament,
  geoForTournament,
  leagueFromSeries,
  nationalityForPlayer,
  parseRulesTournament,
  surfaceForTournament,
  tierFromTournament,
  type TournamentTier,
} from "./tennis-meta.ts";

/** Operational match-winner series registered for cross-venue tennis reconciliation. */
export const TENNIS_MATCH_SERIES: readonly SeriesTicker[] =
  kalshiReconciliationSeriesForSport(SPORT.tennis);

export type KalshiBoardPurpose = "inventory" | "reconciliation" | "trade";

export type TennisMarketView = {
  ticker: string;
  /** Player this market's YES side refers to (yes_sub_title). */
  player: string | null;
  /** Player nationality from research/seed/player-countries.json (null = unknown). */
  playerCountry: string | null;
  /** ISO 3166-1 alpha-3 from the Stadion harvest ("" when from manual seed). */
  playerCountryCode: string | null;
  status: string;
  yesBidCents: number | null;
  yesAskCents: number | null;
  lastCents: number | null;
  volume24h: number | null;
  openInterest: number | null;
  competitorId: string | null;
};

export type TennisEventView = {
  sport: SportKey;
  eventTicker: string;
  /** "Potapova vs Williams" — event-level title from Kalshi. */
  title: string | null;
  subTitle: string | null;
  series: string;
  /** "ATP" | "WTA" | "ATP Challenger" | "WTA 125" | "ITF Men" | "ITF Women". */
  league: string | null;
  /** Governing tour: ATP | WTA | ITF. */
  tour: string | null;
  /** tour | challenger | itf. */
  level: string | null;
  competition: string | null;
  /** Tournament parsed from rules_primary (e.g. "M25 Edwardsville IL"). */
  tournament: string | null;
  /** Round parsed from rules_primary (e.g. "Round of 16"). */
  round: string | null;
  /** City portion of the tournament name. */
  city: string | null;
  /** Event country from research/seed/tennis-geo.json (null = unknown). */
  country: string | null;
  /** ISO 3166-1 alpha-3 from the Stadion venue harvest ("" when from manual seed). */
  countryCode: string | null;
  /** Parsed tournament tier: GS | SPECIAL | 1000 | 500 | 250 | CH | W125 | ITF15…ITF100. */
  tier: TournamentTier;
  /** Court surface from tournament-surfaces seed (null = unknown). */
  surface: string | null;
  /** First market's occurrence_datetime, epoch ms. */
  occurrenceMs: number | null;
  markets: TennisMarketView[];
};

export type TennisBoardSeries = {
  series: SeriesTicker;
  state: "ok" | "unavailable";
  reason?: string;
  events: TennisEventView[];
};

export type TennisBoard = {
  generatedAt: string;
  eventCount: number;
  marketCount: number;
  series: TennisBoardSeries[];
};

export type KalshiSportBoardSeries = TennisBoardSeries & {
  sport: SportKey;
  purpose: KalshiBoardPurpose;
  eventTypes: readonly EventType[];
  participantFormats: readonly ParticipantFormat[];
  marketKinds: readonly MarketKind[];
};

/** Generic board envelope. Tennis callers retain the narrower compatibility view above. */
export type KalshiSportBoard = Omit<TennisBoard, "series"> & {
  sport: SportKey;
  purpose: KalshiBoardPurpose;
  series: KalshiSportBoardSeries[];
};

function dollarsToCents(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function fpToNumber(s: string | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toMarketView(
  m: KalshiMarketWire,
  series: SeriesTicker,
  sport: SportKey,
): TennisMarketView {
  const nat = sport === SPORT.tennis ? nationalityForPlayer(m.yes_sub_title) : null;
  const identityField = kalshiIdentityFieldForSeries(series);
  const competitorId = identityField ? competitorIdForMarket(m, identityField) : undefined;
  return {
    ticker: unbrand(m.ticker),
    player: m.yes_sub_title ?? null,
    playerCountry: nat?.country ?? null,
    playerCountryCode: nat?.iso3 || null,
    status: m.status,
    yesBidCents: dollarsToCents(m.yes_bid_dollars),
    yesAskCents: dollarsToCents(m.yes_ask_dollars),
    // Wire has no last trade field on KalshiMarketWire — mid of best bid/ask.
    lastCents: (() => {
      const bid = dollarsToCents(m.yes_bid_dollars);
      const ask = dollarsToCents(m.yes_ask_dollars);
      if (bid != null && ask != null) return Math.round((bid + ask) / 2);
      return bid ?? ask;
    })(),
    volume24h: fpToNumber(m.volume_24h_fp),
    openInterest: fpToNumber(m.open_interest_fp),
    competitorId: competitorId ? unbrand(competitorId) : null,
  };
}

function toEventView(
  event: KalshiEventWire,
  markets: KalshiMarketWire[],
  sport: SportKey,
): TennisEventView {
  const occ = markets
    .map((m) => (m.occurrence_datetime ? Date.parse(m.occurrence_datetime) : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)[0];
  const series = event.series_ticker ? unbrand(event.series_ticker) : "";
  const isTennis = sport === SPORT.tennis;
  const league = isTennis ? leagueFromSeries(series) : null;
  const rules = isTennis
    ? markets.map((m) => m.rules_primary).find((r) => typeof r === "string")
    : undefined;
  const parsed = isTennis ? parseRulesTournament(rules) : null;
  const binding = event.series_ticker ? kalshiBindingForSeries(event.series_ticker) : undefined;
  const sourceCompetition = binding?.competition ? String(binding.competition) : null;
  const competition = event.product_metadata?.competition ?? sourceCompetition;
  const tournament = isTennis ? parsed?.tournament ?? competition : competition;
  const geo = isTennis ? geoForTournament(tournament) : null;
  return {
    sport,
    eventTicker: unbrand(event.event_ticker),
    title: event.title ?? null,
    subTitle: event.sub_title ?? null,
    series,
    league: league?.league ?? null,
    tour: league?.tour ?? null,
    level: league?.level ?? null,
    competition,
    tournament,
    round: parsed?.round ?? null,
    city: isTennis ? cityFromTournament(tournament) : null,
    country: geo?.country ?? null,
    countryCode: geo?.iso3 || null,
    tier: isTennis ? tierFromTournament(tournament) : null,
    surface: isTennis ? surfaceForTournament(tournament) : null,
    occurrenceMs: occ != null && Number.isFinite(occ) ? occ : null,
    markets: markets.map((market) => toMarketView(market, event.series_ticker!, sport))
      .sort((a, b) => a.ticker.localeCompare(b.ticker)),
  };
}

const BOARD_CACHE_TTL_MS = 60_000;
const boardCaches = new Map<string, { value: KalshiSportBoard; expiresAtMs: number }>();

/** Test hook. */
export function resetTennisBoardCache(): void {
  boardCaches.clear();
}

export type FetchKalshiSportBoardOptions = {
  sport: SportKey;
  purpose: KalshiBoardPurpose;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  series?: readonly SeriesTicker[];
  nowMs?: number;
};

function seriesForPurpose(sport: SportKey, purpose: KalshiBoardPurpose): SeriesTicker[] {
  if (purpose === "inventory") return kalshiInventorySeriesForSport(sport);
  if (purpose === "trade") return kalshiTradeSeriesForSport(sport);
  return kalshiReconciliationSeriesForSport(sport);
}

export async function fetchKalshiSportBoard(
  options: FetchKalshiSportBoardOptions,
): Promise<KalshiSportBoard> {
  const nowMs = options.nowMs ?? Date.now();
  const cacheKey = `${String(options.sport)}:${options.purpose}`;
  const cached = boardCaches.get(cacheKey);
  if (cached && nowMs < cached.expiresAtMs && !options.series) return cached.value;
  const seriesList = options.series ?? seriesForPurpose(options.sport, options.purpose);
  if (seriesList.length === 0) {
    throw new Error(
      `Kalshi ${options.purpose} is not operational for ${String(options.sport)}`,
    );
  }
  const allowedSeries = new Set(
    seriesForPurpose(options.sport, options.purpose).map(unbrand),
  );
  const invalidSeries = seriesList.find(
    (series) =>
      kalshiSportForSeries(series) !== options.sport || !allowedSeries.has(unbrand(series)),
  );
  if (invalidSeries) {
    throw new Error(
      `Kalshi series ${unbrand(invalidSeries)} is not operational for ${String(options.sport)} ${options.purpose}`,
    );
  }
  const settled = await Promise.allSettled(
    seriesList.map((s) =>
      fetchAllKalshiMarkets(
        { series_ticker: s, status: "open", limit: 200 },
        { fetchImpl: options.fetchImpl },
      ),
    ),
  );
  const series: KalshiSportBoardSeries[] = settled.map((r, i) => {
    const s = seriesList[i]!;
    const binding = kalshiBindingForSeries(s);
    const metadata = {
      sport: options.sport,
      purpose: options.purpose,
      eventTypes: binding?.eventTypes ?? [],
      participantFormats: binding?.participantFormats ?? [],
      marketKinds: binding?.marketKinds ?? [],
    };
    if (r.status === "rejected") {
      return {
        ...metadata,
        series: s,
        state: "unavailable",
        reason: r.reason instanceof Error ? r.reason.message : String(r.reason),
        events: [],
      };
    }
    const markets = r.value;
    const byEvent = new Map<string, KalshiMarketWire[]>();
    for (const m of markets) {
      const key = unbrand(m.event_ticker);
      const list = byEvent.get(key);
      if (list) list.push(m);
      else byEvent.set(key, [m]);
    }
    const events: TennisEventView[] = [];
    for (const [eventTicker, eventMarkets] of byEvent) {
      // Markets page does not embed event titles — synthesize a minimal wire.
      const isMatch =
        binding?.eventTypes.includes("match") === true &&
        binding.participantFormats.includes("field") === false;
      const participantTitle = eventMarkets
        .map((m) => m.yes_sub_title)
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .slice(0, 2)
        .join(" vs ");
      const synthetic: KalshiEventWire = {
        event_ticker: asKalshiEventTicker(eventTicker),
        series_ticker: s,
        title: isMatch
          ? participantTitle || undefined
          : binding?.competition
            ? String(binding.competition)
            : undefined,
      };
      events.push(toEventView(synthetic, eventMarkets, options.sport));
    }
    events.sort((a, b) => (a.occurrenceMs ?? Infinity) - (b.occurrenceMs ?? Infinity));
    return { ...metadata, series: s, state: "ok", events };
  });
  const board: KalshiSportBoard = {
    sport: options.sport,
    purpose: options.purpose,
    generatedAt: new Date(nowMs).toISOString(),
    eventCount: series.reduce((n, s) => n + s.events.length, 0),
    marketCount: series.reduce((n, s) => n + s.events.reduce((m, e) => m + e.markets.length, 0), 0),
    series,
  };
  if (!options.series) {
    boardCaches.set(cacheKey, { value: board, expiresAtMs: nowMs + BOARD_CACHE_TTL_MS });
  }
  return board;
}

export async function fetchTennisBoard(options: {
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  series?: readonly SeriesTicker[];
  nowMs?: number;
} = {}): Promise<TennisBoard> {
  return fetchKalshiSportBoard({
    ...options,
    sport: SPORT.tennis,
    purpose: "reconciliation",
  });
}

export async function fetchTennisTradeBoard(
  options: Omit<FetchKalshiSportBoardOptions, "sport" | "purpose"> = {},
): Promise<KalshiSportBoard> {
  return fetchKalshiSportBoard({ ...options, sport: SPORT.tennis, purpose: "trade" });
}

export async function fetchTableTennisInventoryBoard(
  options: Omit<FetchKalshiSportBoardOptions, "sport" | "purpose"> = {},
): Promise<KalshiSportBoard> {
  return fetchKalshiSportBoard({ ...options, sport: SPORT.tableTennis, purpose: "inventory" });
}
