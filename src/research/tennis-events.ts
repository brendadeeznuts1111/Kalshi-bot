/**
 * Tennis event board — pulls every open tennis match event from Kalshi's
 * events API (with nested markets), normalizes names/prices into a view model
 * for the HQ Events tab, and caches briefly so dashboard polling doesn't
 * turn into an upstream burst.
 *
 * Money in = Kalshi wire strings (`*_dollars`, `*_fp`); money out = cents ints.
 * Desk liquidity flags (`deskLiquidity`) are attached at the serve boundary
 * from match_liquidity — not part of the Kalshi cache payload.
 */
// @see https://docs.kalshi.com/api-reference/market/get-markets
// @see https://docs.kalshi.com/api-reference/events/get-events
import {
  fetchAllKalshiMarkets,
  type KalshiEventWire,
  type KalshiMarketWire,
} from "../bot/kalshi-events-api.ts";
import {
  asKalshiEventTicker,
  asSeriesTicker,
  unbrand,
  type SeriesTicker,
} from "../institutions/event-store/brands.ts";
import type { DeskLiquidityFlags } from "../institutions/event-store/match-liquidity.ts";
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

/** Core match-winner series we track on the board. */
export const TENNIS_MATCH_SERIES: readonly SeriesTicker[] = [
  "KXATPMATCH",
  "KXWTAMATCH",
  "KXATPCHALLENGERMATCH",
  "KXWTACHALLENGERMATCH",
  "KXITFMATCH",
  "KXITFWMATCH",
  "KXITFDOUBLES",
  "KXITFWDOUBLES",
].map(asSeriesTicker);

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
  /**
   * Desk match_liquidity join (optional). Present when serve attaches
   * event-store flags for board filters / per-row badges.
   */
  deskLiquidity?: DeskLiquidityFlags;
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

function toMarketView(m: KalshiMarketWire): TennisMarketView {
  const nat = nationalityForPlayer(m.yes_sub_title);
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
    competitorId: m.custom_strike?.tennis_competitor
      ? unbrand(m.custom_strike.tennis_competitor)
      : null,
  };
}

function toEventView(event: KalshiEventWire, markets: KalshiMarketWire[]): TennisEventView {
  const occ = markets
    .map((m) => (m.occurrence_datetime ? Date.parse(m.occurrence_datetime) : NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)[0];
  const series = event.series_ticker ? unbrand(event.series_ticker) : "";
  const league = leagueFromSeries(series);
  const rules = markets.map((m) => m.rules_primary).find((r) => typeof r === "string");
  const parsed = parseRulesTournament(rules);
  const tournament = parsed?.tournament ?? event.product_metadata?.competition ?? null;
  const geo = geoForTournament(tournament);
  return {
    eventTicker: unbrand(event.event_ticker),
    title: event.title ?? null,
    subTitle: event.sub_title ?? null,
    series,
    league: league?.league ?? null,
    tour: league?.tour ?? null,
    level: league?.level ?? null,
    competition: event.product_metadata?.competition ?? null,
    tournament,
    round: parsed?.round ?? null,
    city: cityFromTournament(tournament),
    country: geo?.country ?? null,
    countryCode: geo?.iso3 || null,
    tier: tierFromTournament(tournament),
    surface: surfaceForTournament(tournament),
    occurrenceMs: occ != null && Number.isFinite(occ) ? occ : null,
    markets: markets.map(toMarketView).sort((a, b) => a.ticker.localeCompare(b.ticker)),
  };
}

const BOARD_CACHE_TTL_MS = 60_000;
let boardCache: { value: TennisBoard; expiresAtMs: number } | null = null;

/** Test hook. */
export function resetTennisBoardCache(): void {
  boardCache = null;
}

export async function fetchTennisBoard(options: {
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  series?: readonly SeriesTicker[];
  nowMs?: number;
} = {}): Promise<TennisBoard> {
  const nowMs = options.nowMs ?? Date.now();
  if (boardCache && nowMs < boardCache.expiresAtMs && !options.series) return boardCache.value;
  const seriesList = options.series ?? TENNIS_MATCH_SERIES;
  const settled = await Promise.allSettled(
    seriesList.map((s) =>
      fetchAllKalshiMarkets(
        { series_ticker: s, status: "open", limit: 200 },
        { fetchImpl: options.fetchImpl },
      ),
    ),
  );
  const series: TennisBoardSeries[] = settled.map((r, i) => {
    const s = seriesList[i]!;
    if (r.status === "rejected") {
      return {
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
      const synthetic: KalshiEventWire = {
        event_ticker: asKalshiEventTicker(eventTicker),
        series_ticker: s,
        title: eventMarkets
          .map((m) => m.yes_sub_title)
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .slice(0, 2)
          .join(" vs ") || undefined,
      };
      events.push(toEventView(synthetic, eventMarkets));
    }
    events.sort((a, b) => (a.occurrenceMs ?? Infinity) - (b.occurrenceMs ?? Infinity));
    return { series: s, state: "ok", events };
  });
  const board: TennisBoard = {
    generatedAt: new Date(nowMs).toISOString(),
    eventCount: series.reduce((n, s) => n + s.events.length, 0),
    marketCount: series.reduce((n, s) => n + s.events.reduce((m, e) => m + e.markets.length, 0), 0),
    series,
  };
  if (!options.series) boardCache = { value: board, expiresAtMs: nowMs + BOARD_CACHE_TTL_MS };
  return board;
}

/** Desk liquidity filter values for GET /api/events?liquidity=… and HQ select. */
export type EventsBoardLiquidityFilter =
  | "all"
  | "priced"
  | "active"
  | "quoted"
  | "liq_ok"
  | "tradable";

export type EventsBoardFilterOptions = {
  /** Desk + quote filters (glossary ui.events.filter.liquidity). */
  liquidity?: EventsBoardLiquidityFilter | string | null;
  /** Min gate volume (24h preferred, else lifetime from desk; else board 24h sum). */
  minVolume?: number | null;
  /** Alias used by HQ form (`minVol`). */
  minVol?: number | null;
  /** When true, drop series with zero matching events. Default true. */
  dropEmptySeries?: boolean;
};

function eventMatchesDeskLiquidity(
  event: TennisEventView,
  liquidity: string,
): boolean {
  if (!liquidity || liquidity === "all") return true;
  const desk = event.deskLiquidity;
  if (liquidity === "priced") {
    return event.markets.some((m) => m.yesBidCents != null && m.yesAskCents != null);
  }
  if (liquidity === "active") {
    return event.markets.some((m) => m.status === "active");
  }
  if (liquidity === "quoted") return desk?.quoted === true;
  if (liquidity === "liq_ok" || liquidity === "liquidity_ok") return desk?.liquidityOk === true;
  if (liquidity === "tradable") return desk?.tradable === true;
  return true;
}

function eventVolumeForMinGate(event: TennisEventView): number {
  if (event.deskLiquidity) {
    return event.deskLiquidity.volumeForGate;
  }
  return event.markets.reduce((s, m) => s + (m.volume24h ?? 0), 0);
}

/**
 * Attach desk flags by eventTicker and optionally filter (server query params).
 * Returns a new board; does not mutate the cached Kalshi payload.
 */
export function attachDeskLiquidityToBoard(
  board: TennisBoard,
  byEvent: ReadonlyMap<string, DeskLiquidityFlags>,
  filters: EventsBoardFilterOptions = {},
): TennisBoard {
  const liquidity = (filters.liquidity ?? "all").trim() || "all";
  const minVolume = Number(filters.minVolume ?? filters.minVol ?? 0) || 0;
  const dropEmpty = filters.dropEmptySeries !== false;

  const series: TennisBoardSeries[] = board.series.map((s) => {
    if (s.state !== "ok") return s;
    const events = s.events
      .map((e) => {
        const desk = byEvent.get(e.eventTicker);
        return desk ? { ...e, deskLiquidity: desk } : { ...e };
      })
      .filter((e) => eventMatchesDeskLiquidity(e, liquidity))
      .filter((e) => (minVolume > 0 ? eventVolumeForMinGate(e) >= minVolume : true));
    return { ...s, events };
  }).filter((s) => (dropEmpty && s.state === "ok" ? s.events.length > 0 : true));

  return {
    generatedAt: board.generatedAt,
    eventCount: series.reduce((n, s) => n + s.events.length, 0),
    marketCount: series.reduce(
      (n, s) => n + s.events.reduce((m, e) => m + e.markets.length, 0),
      0,
    ),
    series,
  };
}
