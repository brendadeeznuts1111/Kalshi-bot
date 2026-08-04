// @see https://docs.kalshi.com/api-reference/market/get-markets
// @see https://bun.com/docs/runtime/utils#bun-sleep
import type { Database } from "bun:sqlite";
import {
  ITF_SERIES_TICKERS,
  itfSideCodesForEvent,
  itfTourFromSeries,
  parseItfEventTicker,
  parseItfSeriesPrefix,
  parseItfYesSideCode,
} from "../../alpha/ticker-formats/itf.ts";
import {
  TOUR_SERIES_TICKERS,
  tourFromSeries,
  tourSideCodesForEvent,
  parseTourEventTicker,
  parseTourSeriesPrefix,
  parseTourYesSideCode,
} from "../../alpha/ticker-formats/tour.ts";
import {
  fetchAllKalshiMarkets,
  fetchKalshiEvent,
  type KalshiFetchImpl,
  type KalshiMarketWire,
} from "../../bot/kalshi-events-api.ts";
import { OFFICIAL_URLS } from "../official-urls.ts";
import {
  attachItfLegBookDepth,
  buildItfCalendarRows,
  groupMarketsByEvent,
  playerLabels,
  type ItfCalendarRow,
} from "./itf-calendar.ts";
import {
  kalshiMarketId,
  kalshiSourceRowHash,
  tryMintKalshiEventIdFromMarkets,
} from "./kalshi-event-id.ts";
import type { CanonicalEventId, KalshiEventTicker, KalshiMarketTicker, SeriesTicker } from "./brands.ts";
import { asKalshiEventTicker, asSeriesTicker, sqlBrand, tryKalshiEventTicker, unbrand } from "./brands.ts";
import type { BookSnapshot } from "../alpha-signal-types.ts";
import { fetchKalshiBookSnapshot } from "../../bot/kalshi-market-data.ts";
import { recomputeMatchLiquidityForEvents } from "./match-liquidity.ts";
import {
  extractMatchupDateBlob,
  formatLadderCoverage,
  ladderFamilyFromTicker,
  ladderSeriesForTicker,
  marketKindFromTicker,
  parseTennisSeriesPrefix,
  summarizeLadderCoverage,
  type LadderCoverage,
} from "./tennis-ladder.ts";
import {
  KALSHI_BOOK_SOURCE_REST,
  KALSHI_EVENT_SOURCE,
} from "./tennis-lane-constants.ts";

export type { ItfCalendarLeg, ItfCalendarRow, ItfCalendarStats, ItfCalendarFilter } from "./itf-calendar.ts";
export {
  attachItfLegBookDepth,
  buildItfCalendarRows,
  filterItfCalendarRows,
  summarizeItfCalendar,
  topItfEventsByFlow,
  topItfEventsByVolume,
  tickersForEvents,
  groupMarketsByEvent,
} from "./itf-calendar.ts";

export type ItfMarketsByStatus = {
  open: number;
  closed: number;
  settled: number;
};

export type ItfSyncSummary = {
  seriesScanned: number;
  /** Deduped market tickers seen (open + retained closed/settled). */
  marketsSeen: number;
  marketsSeenByStatus: ItfMarketsByStatus;
  retainDays: number;
  eventsUpserted: number;
  marketsUpserted: number;
  eventsSkipped: number;
  anomalies: string[];
};

export type ItfFetchOptions = {
  fetchImpl?: KalshiFetchImpl;
  baseUrl?: string;
  /** Override clock for retain window (ms since epoch). */
  nowMs?: number;
};

/** Default lookback for closed/settled ITF markets so Stadion collect can bridge. */
export const DEFAULT_ITF_RETAIN_DAYS = 3;

const KALSHI_VENUE = "kalshi";
const KALSHI_SOURCE = KALSHI_EVENT_SOURCE;
const KALSHI_MARKETS_URL = `${OFFICIAL_URLS.kalshi.tradeApiV2Base}/markets`;
const KALSHI_ORDERBOOK_URL = (ticker: KalshiMarketTicker) =>
  `${OFFICIAL_URLS.kalshi.tradeApiV2Base}/markets/${encodeURIComponent(unbrand(ticker))}/orderbook`;
const TRADING_CORPUS = "trading";

/** All tennis series Kalshi offers — ITF + Tour + Challenger. */
export const ALL_TENNIS_SERIES = [...ITF_SERIES_TICKERS, ...TOUR_SERIES_TICKERS] as const;

function parseRulesBlob(markets: KalshiMarketWire[]): string {
  const primary = markets[0]?.rules_primary ?? "";
  const secondary = markets[0]?.rules_secondary ?? "";
  return JSON.stringify({ rules_primary: primary, rules_secondary: secondary });
}

function extractRound(title: string, rules: string): string {
  const hay = `${title} ${rules}`.toLowerCase();
  const m = hay.match(/round of (\d+|32|16|8|4)|\br\d+\b|quarterfinal|semifinal|final\b/);
  return m?.[0] ?? "unknown";
}

function extractTournament(title: string, subTitle: string): string {
  const m = title.match(/:\s*(.+?)\s+(?:Round|match)/i);
  if (m?.[1]) return m[1].trim();
  return subTitle.split("(")[0]?.trim() || title;
}

/** Extract location from Kalshi event sub_title (e.g. "Wimbledon (London)") or product metadata. */
function extractLocation(subTitle: string): string {
  const fromParen = subTitle.match(/\(([^)]+)\)/);
  if (fromParen?.[1]) return fromParen[1].trim();
  return "";
}

/** Resolve series-specific side-code parser and tour label. */
function seriesHelpers(series: SeriesTicker) {
  const plain = unbrand(series);
  if (ITF_SERIES_TICKERS.includes(plain as (typeof ITF_SERIES_TICKERS)[number])) {
    return {
      tourLabel: (s: SeriesTicker) => itfTourFromSeries(unbrand(s)),
      sideCodesForEvent: itfSideCodesForEvent,
      parseYesSideCode: parseItfYesSideCode,
      parseEventTicker: parseItfEventTicker,
      parseSeriesPrefix: parseItfSeriesPrefix,
    };
  }
  return {
    tourLabel: (s: SeriesTicker) => tourFromSeries(unbrand(s)),
    sideCodesForEvent: tourSideCodesForEvent,
    parseYesSideCode: parseTourYesSideCode,
    parseEventTicker: parseTourEventTicker,
    parseSeriesPrefix: parseTourSeriesPrefix,
  };
}

async function fetchAllKalshiMarketsRetry(
  params: Parameters<typeof fetchAllKalshiMarkets>[0],
  options: ItfFetchOptions = {},
  attempts = 4,
): Promise<KalshiMarketWire[]> {
  let lastErr: unknown;
  const fetchOpts = { fetchImpl: options.fetchImpl, baseUrl: options.baseUrl };
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchAllKalshiMarkets(params, fetchOpts);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/429|Too Many Requests/i.test(msg) || i === attempts - 1) throw err;
      await Bun.sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

function dedupeMarketsByTicker(markets: KalshiMarketWire[]): KalshiMarketWire[] {
  const byTicker = new Map<string, KalshiMarketWire>();
  for (const m of markets) byTicker.set(unbrand(m.ticker), m);
  return [...byTicker.values()];
}

export async function fetchOpenTennisMarkets(
  seriesList: readonly string[] = ALL_TENNIS_SERIES,
  options: ItfFetchOptions = {},
): Promise<KalshiMarketWire[]> {
  const out: KalshiMarketWire[] = [];
  for (const series of seriesList) {
    out.push(
      ...(await fetchAllKalshiMarketsRetry(
        { series_ticker: asSeriesTicker(series), status: "open" },
        options,
      )),
    );
  }
  return out;
}

/** @deprecated Use `fetchOpenTennisMarkets(ITF_SERIES_TICKERS)` */
export async function fetchOpenItfMarkets(
  options: ItfFetchOptions = {},
): Promise<KalshiMarketWire[]> {
  return fetchOpenTennisMarkets(ITF_SERIES_TICKERS, options);
}

export type RetainedTennisMarkets = {
  markets: KalshiMarketWire[];
  byStatus: ItfMarketsByStatus;
};

export async function fetchRetainedTennisMarkets(
  seriesList: readonly string[] = ALL_TENNIS_SERIES,
  options: ItfFetchOptions & { retainDays?: number } = {},
): Promise<RetainedTennisMarkets> {
  const retainDays = options.retainDays ?? DEFAULT_ITF_RETAIN_DAYS;
  if (retainDays <= 0) {
    const open = await fetchOpenTennisMarkets(seriesList, options);
    return { markets: open, byStatus: { open: open.length, closed: 0, settled: 0 } };
  }
  const nowMs = options.nowMs ?? Date.now();
  const minTs = Math.floor(nowMs / 1000) - Math.floor(retainDays * 86_400);
  const open: KalshiMarketWire[] = [];
  const closed: KalshiMarketWire[] = [];
  const settled: KalshiMarketWire[] = [];
  for (const series of seriesList) {
    const seriesTicker = asSeriesTicker(series);
    open.push(
      ...(await fetchAllKalshiMarketsRetry({ series_ticker: seriesTicker, status: "open" }, options)),
    );
    closed.push(
      ...(await fetchAllKalshiMarketsRetry(
        { series_ticker: seriesTicker, status: "closed", min_close_ts: minTs },
        options,
      )),
    );
    settled.push(
      ...(await fetchAllKalshiMarketsRetry(
        { series_ticker: seriesTicker, status: "settled", min_settled_ts: minTs },
        options,
      )),
    );
  }
  return {
    markets: dedupeMarketsByTicker([...open, ...closed, ...settled]),
    byStatus: { open: open.length, closed: closed.length, settled: settled.length },
  };
}

/** @deprecated Use `fetchRetainedTennisMarkets(ITF_SERIES_TICKERS)` */
export async function fetchRetainedItfMarkets(
  options: ItfFetchOptions & { retainDays?: number } = {},
): Promise<RetainedTennisMarkets> {
  return fetchRetainedTennisMarkets(ITF_SERIES_TICKERS, options);
}

/** Map Kalshi yes/no settlement onto yes_side_label competitors. */
export function settlementFromKalshiMarkets(markets: KalshiMarketWire[]): {
  winner: string;
  loser: string;
  outcome: string;
} | null {
  const labels = markets
    .map((m) => m.yes_sub_title?.trim())
    .filter((l): l is string => Boolean(l));
  const uniqueLabels = [...new Set(labels)];
  if (uniqueLabels.length < 2) return null;

  let winner: string | undefined;
  for (const m of markets) {
    const yes = m.yes_sub_title?.trim();
    if (!yes) continue;
    const result = m.result?.trim().toLowerCase();
    if (result === "yes") {
      winner = yes;
      break;
    }
    if (result === "no") {
      winner = uniqueLabels.find((l) => l !== yes);
      if (winner) break;
    }
  }
  if (!winner) return null;
  const loser = uniqueLabels.find((l) => l !== winner);
  if (!loser) return null;
  return { winner, loser, outcome: "completed" };
}

export async function fetchItfCalendarRow(eventTicker: KalshiEventTicker): Promise<ItfCalendarRow | null> {
  const markets = await fetchOpenItfMarkets();
  const rows = buildItfCalendarRows(markets.filter((m) => m.event_ticker === eventTicker));
  return rows[0] ?? null;
}

export type UpsertKalshiEventResult =
  | { ok: true; eventId: CanonicalEventId; keyedBy: "competitors" | "ticker" }
  | { ok: false; anomaly: string };

function upsertKalshiEvent(
  db: Database,
  eventTicker: KalshiEventTicker,
  markets: KalshiMarketWire[],
  eventTitle: string,
  eventSubTitle: string,
  ingestedAt: number,
): UpsertKalshiEventResult {
  const sample = markets[0]!;
  const series = asSeriesTicker(parseTennisSeriesPrefix(unbrand(sample.ticker)) ?? "KXITFMATCH");
  const helpers = seriesHelpers(series);
  const labels = playerLabels(markets);
  const sideCodes = helpers.sideCodesForEvent(
    unbrand(eventTicker),
    markets.map((m) => unbrand(m.ticker)),
  );
  if (!sideCodes) {
    return {
      ok: false,
      anomaly: `ambiguous_blob:${unbrand(eventTicker)} — refuse best-guess side split`,
    };
  }
  const startTs = sample.occurrence_datetime?.trim() ?? "";
  if (!startTs) {
    return {
      ok: false,
      anomaly: `missing_occurrence:${unbrand(eventTicker)} — refuse expected_expiration / wall-clock mint`,
    };
  }
  const minted = tryMintKalshiEventIdFromMarkets({
    eventTicker,
    series,
    startTs,
    competitorIds: markets.map((m) => m.custom_strike?.tennis_competitor),
  });
  if (minted.keyedBy === "ticker") {
    return {
      ok: false,
      anomaly: `ticker_keyed_event_id:${unbrand(eventTicker)} — missing tennis_competitor pair; refuse trading upsert`,
    };
  }
  const sourceRowHash = kalshiSourceRowHash(eventTicker);
  const prior = db
    .query(`SELECT event_id AS eventId FROM events WHERE source_row_hash = $hash`)
    .get({ $hash: sourceRowHash }) as { eventId: string } | null;
  const eventId = (prior ? sqlBrand.eventId(prior.eventId) : undefined) ?? minted.eventId;
  const keyedBy = minted.keyedBy;
  const playerA = labels?.[0] ?? sideCodes[0]!;
  const playerB = labels?.[1] ?? sideCodes[1]!;
  const rules = parseRulesBlob(markets);
  const settlement = settlementFromKalshiMarkets(markets);
  const winner = settlement?.winner ?? "";
  const loser = settlement?.loser ?? "";
  const outcome = settlement?.outcome ?? "scheduled";

  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, score_text, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus
    ) VALUES (
      $event_id, $tour, $level, $tournament, $location, 'unknown', '', $round, NULL,
      $player_a, $player_b, $winner, $loser, $start_ts, $outcome, '', $source, $source_url, $fetched_ts,
      $source_row_hash, $ingested_at, $corpus
    )
    ON CONFLICT (event_id) DO UPDATE SET
      tour = excluded.tour,
      level = excluded.level,
      tournament = excluded.tournament,
      location = CASE WHEN length(excluded.location) > 0 THEN excluded.location ELSE events.location END,
      round = excluded.round,
      player_a = excluded.player_a,
      player_b = excluded.player_b,
      start_ts = excluded.start_ts,
      source = excluded.source,
      source_url = excluded.source_url,
      fetched_ts = excluded.fetched_ts,
      source_row_hash = excluded.source_row_hash,
      ingested_at = excluded.ingested_at,
      corpus = excluded.corpus,
      winner = CASE WHEN length(events.winner) > 0 THEN events.winner ELSE excluded.winner END,
      loser = CASE WHEN length(events.loser) > 0 THEN events.loser ELSE excluded.loser END,
      outcome = CASE WHEN length(events.winner) > 0 THEN events.outcome ELSE excluded.outcome END,
      score_text = CASE
        WHEN length(COALESCE(events.score_text, '')) > 0 THEN events.score_text
        ELSE excluded.score_text
      END`,
  ).run({
    $event_id: unbrand(eventId),
    $tour: helpers.tourLabel(series),
    $level: eventSubTitle || unbrand(series),
    $tournament: extractTournament(eventTitle, eventSubTitle),
    $location: extractLocation(eventSubTitle),
    $round: extractRound(eventTitle, rules),
    $player_a: playerA,
    $player_b: playerB,
    $winner: winner,
    $loser: loser,
    $start_ts: startTs,
    $outcome: outcome,
    $source: KALSHI_SOURCE,
    $source_url: `${KALSHI_MARKETS_URL}?event_ticker=${encodeURIComponent(unbrand(eventTicker))}`,
    $fetched_ts: ingestedAt,
    $source_row_hash: sourceRowHash,
    $ingested_at: ingestedAt,
    $corpus: TRADING_CORPUS,
  });

  for (const m of markets) {
    const sideCode = helpers.parseYesSideCode(unbrand(m.ticker)) ?? "";
    const mSeries = asSeriesTicker(parseTennisSeriesPrefix(unbrand(m.ticker)) ?? unbrand(series));
    db.query(
      `INSERT OR REPLACE INTO markets (
        market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
        competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts,
        volume_fp, volume_24h_fp, open_interest_fp, yes_bid_size_fp, yes_ask_size_fp
      ) VALUES (
        $market_id, $event_id, $venue, $ticker, $series, $market_kind, $yes_side_label, $side_code,
        $competitor_id, $rules_blob, NULL, $source, $source_url, $fetched_ts,
        $volume_fp, $volume_24h_fp, $open_interest_fp, $yes_bid_size_fp, $yes_ask_size_fp
      )`,
    ).run({
      $market_id: unbrand(kalshiMarketId(m.ticker)),
      $event_id: unbrand(eventId),
      $venue: KALSHI_VENUE,
      $ticker: unbrand(m.ticker),
      $series: unbrand(mSeries),
      $market_kind: marketKindFromTicker(unbrand(m.ticker)),
      $yes_side_label: m.yes_sub_title ?? "",
      $side_code: sideCode,
      $competitor_id: m.custom_strike?.tennis_competitor ? unbrand(m.custom_strike.tennis_competitor) : null,
      $rules_blob: rules,
      $source: KALSHI_SOURCE,
      $source_url: `${KALSHI_MARKETS_URL}?ticker=${encodeURIComponent(unbrand(m.ticker))}`,
      $fetched_ts: ingestedAt,
      $volume_fp: m.volume_fp ?? null,
      $volume_24h_fp: m.volume_24h_fp ?? null,
      $open_interest_fp: m.open_interest_fp ?? null,
      $yes_bid_size_fp: m.yes_bid_size_fp ?? null,
      $yes_ask_size_fp: m.yes_ask_size_fp ?? null,
    });
  }

  return { ok: true, eventId, keyedBy };
}

/** Open markets across the ladder family that share this matchup date-blob. */
export async function fetchLadderMarketsForEvent(
  eventTickerOrMarket: KalshiEventTicker | KalshiMarketTicker,
): Promise<{ markets: KalshiMarketWire[]; coverage: LadderCoverage }> {
  const plain = unbrand(eventTickerOrMarket);
  const blob = extractMatchupDateBlob(plain);
  const family = ladderFamilyFromTicker(plain);
  const seriesList = ladderSeriesForTicker(plain);
  if (!blob || seriesList.length === 0) {
    return {
      markets: [],
      coverage: summarizeLadderCoverage(family, blob, []),
    };
  }
  const markets: KalshiMarketWire[] = [];
  for (const series of seriesList) {
    try {
      const batch = await fetchAllKalshiMarketsRetry(
        { series_ticker: asSeriesTicker(series), status: "open" },
        {},
      );
      for (const m of batch) {
        const mBlob =
          extractMatchupDateBlob(unbrand(m.event_ticker)) ?? extractMatchupDateBlob(unbrand(m.ticker));
        if (mBlob === blob) markets.push(m);
      }
    } catch {
      // One series 429/empty must not abort the whole ladder poll.
    }
  }
  const tickers = markets.map((m) => m.ticker);
  return { markets, coverage: summarizeLadderCoverage(family, blob, tickers) };
}

export type SyncTennisEventsOptions = ItfFetchOptions & {
  fetchEventDetails?: boolean;
  eventTickers?: KalshiEventTicker[];
  /** Days of closed/settled markets to retain (default 3). `0` = open-only. */
  retainDays?: number;
  /** Series to scan — defaults to all tennis (ITF + Tour + Challenger). */
  series?: readonly string[];
};

/** @deprecated Prefer `SyncTennisEventsOptions` */
export type SyncItfEventsOptions = SyncTennisEventsOptions;

export async function syncTennisEvents(
  db: Database,
  options: SyncTennisEventsOptions = {},
): Promise<ItfSyncSummary> {
  const seriesList = options.series ?? ALL_TENNIS_SERIES;
  const retainDays = options.retainDays ?? DEFAULT_ITF_RETAIN_DAYS;
  const retained = await fetchRetainedTennisMarkets(seriesList, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    nowMs: options.nowMs,
    retainDays,
  });
  const markets = retained.markets;
  let grouped = groupMarketsByEvent(markets);
  if (options.eventTickers?.length) {
    const allow = new Set(options.eventTickers.map(unbrand));
    grouped = new Map([...grouped.entries()].filter(([k]) => allow.has(unbrand(k))));
  }
  const ingestedAt = options.nowMs ?? Date.now();
  let eventsUpserted = 0;
  let marketsUpserted = 0;
  let eventsSkipped = 0;
  const anomalies: string[] = [];

  db.run("BEGIN");
  try {
    for (const [eventTicker, eventMarkets] of grouped) {
      let title = unbrand(eventTicker);
      let subTitle = "";
      let marketsForEvent = eventMarkets;
      if (options.fetchEventDetails) {
        try {
          const detail = await fetchKalshiEvent(eventTicker, {
            fetchImpl: options.fetchImpl,
            baseUrl: options.baseUrl,
          });
          title = detail.event.title ?? title;
          subTitle = detail.event.sub_title ?? subTitle;
          marketsForEvent = detail.markets;
        } catch {
          // list payload is enough for sync
        }
      } else {
        const labels = playerLabels(eventMarkets);
        if (labels) title = `${labels[0]} vs ${labels[1]}`;
      }
      const result = upsertKalshiEvent(db, eventTicker, marketsForEvent, title, subTitle, ingestedAt);
      if (!result.ok) {
        eventsSkipped++;
        anomalies.push(result.anomaly);
        continue;
      }
      eventsUpserted++;
      marketsUpserted += marketsForEvent.length;
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  return {
    seriesScanned: seriesList.length,
    marketsSeen: markets.length,
    marketsSeenByStatus: retained.byStatus,
    retainDays,
    eventsUpserted,
    marketsUpserted,
    eventsSkipped,
    anomalies,
  };
}

/** @deprecated Prefer `syncTennisEvents` — pass `series: ITF_SERIES_TICKERS` for ITF-only. */
export async function syncItfEvents(
  db: Database,
  options: SyncTennisEventsOptions = {},
): Promise<ItfSyncSummary> {
  return syncTennisEvents(db, { ...options, series: ITF_SERIES_TICKERS });
}

/** @deprecated Prefer `syncTennisEvents` */
export async function syncOpenItfEvents(
  db: Database,
  options: SyncTennisEventsOptions = {},
): Promise<ItfSyncSummary> {
  return syncItfEvents(db, options);
}

export type RecordBookTickSummary = {
  ticksRecorded: number;
  marketsPolled: number;
  errors: number;
  eventCount: number;
  coverage?: LadderCoverage;
  coverageLine?: string;
};

export async function recordKalshiBookTicks(
  db: Database,
  tickers: KalshiMarketTicker[],
  options: {
    fetchBook?: typeof fetchKalshiBookSnapshot;
    syncFirst?: boolean;
    coverage?: LadderCoverage;
  } = {},
): Promise<RecordBookTickSummary> {
  const fetchBook = options.fetchBook ?? fetchKalshiBookSnapshot;
  let ticksRecorded = 0;
  let errors = 0;
  const eventTickers = new Set<KalshiEventTicker>();
  const eventIdsForLiquidity = new Set<string>();

  if (options.syncFirst && tickers.length > 0) {
    const events = tickers
      .map((t) => parseItfEventTicker(unbrand(t)) ?? parseTourEventTicker(unbrand(t)))
      .filter((e): e is string => Boolean(e))
      .map((e) => asKalshiEventTicker(e));
    if (events.length) {
      const unique = [...new Map(events.map((e) => [unbrand(e), e])).values()];
      await syncOpenItfEvents(db, { eventTickers: unique });
    }
  }

  for (const ticker of tickers) {
    const tickerPlain = unbrand(ticker);
    const eventTickerWire =
      parseItfEventTicker(tickerPlain) ?? parseTourEventTicker(tickerPlain) ?? tickerPlain.replace(/-[A-Z0-9]+$/, "");
    const eventTicker = tryKalshiEventTicker(eventTickerWire);
    if (!eventTicker) {
      errors++;
      continue;
    }
    eventTickers.add(eventTicker);
    const mapped = db
      .query(`SELECT event_id AS eventId FROM markets WHERE ticker = $ticker`)
      .get({ $ticker: tickerPlain }) as { eventId: string } | null;
    if (!mapped?.eventId) {
      errors++;
      continue;
    }
    const eventId = sqlBrand.eventId(mapped.eventId);
    eventIdsForLiquidity.add(unbrand(eventId));
    const kind = marketKindFromTicker(ticker);
    try {
      const book: BookSnapshot = await fetchBook(ticker);
      const recvTs = Date.now();
      db.query(
        `INSERT INTO book_ticks (
           event_id, ticker, market_kind, ts, recv_ts, source_clock, seq, levels_json, source, source_url
         ) VALUES (
           $event_id, $ticker, $market_kind, $ts, $recv_ts, 'recv', NULL, $levels_json, $source, $source_url
         )`,
      ).run({
        $event_id: unbrand(eventId),
        $ticker: tickerPlain,
        $market_kind: kind,
        $ts: recvTs,
        $recv_ts: recvTs,
        $levels_json: JSON.stringify(book),
        $source: KALSHI_BOOK_SOURCE_REST,
        $source_url: KALSHI_ORDERBOOK_URL(ticker),
      });
      ticksRecorded++;
    } catch {
      errors++;
    }
  }

  // Derived match_liquidity after batch (REST consumers read this table).
  if (eventIdsForLiquidity.size > 0) {
    recomputeMatchLiquidityForEvents(db, [...eventIdsForLiquidity]);
  }

  const coverage = options.coverage;
  return {
    ticksRecorded,
    marketsPolled: tickers.length,
    errors,
    eventCount: eventTickers.size,
    coverage,
    coverageLine: coverage ? formatLadderCoverage(coverage) : undefined,
  };
}

/** Expand an event ticker to the full open ladder, then record every book. */
export async function recordEventLadder(
  db: Database,
  eventTicker: KalshiEventTicker,
  options: { fetchBook?: typeof fetchKalshiBookSnapshot; syncFirst?: boolean } = {},
): Promise<RecordBookTickSummary> {
  const { markets, coverage } = await fetchLadderMarketsForEvent(eventTicker);
  const tickers = markets.map((m) => m.ticker);
  if (tickers.length === 0) {
    return {
      ticksRecorded: 0,
      marketsPolled: 0,
      errors: 0,
      eventCount: 0,
      coverage,
      coverageLine: formatLadderCoverage(coverage),
    };
  }
  return recordKalshiBookTicks(db, tickers, {
    fetchBook: options.fetchBook,
    syncFirst: options.syncFirst,
    coverage,
  });
}

export async function recordTopItfEvents(
  db: Database,
  options: { top?: number; minVolume?: number; syncFirst?: boolean } = {},
): Promise<{ rows: ItfCalendarRow[]; record: RecordBookTickSummary }> {
  const markets = await fetchOpenItfMarkets();
  const allRows = buildItfCalendarRows(markets);
  let rows = allRows;
  if (options.minVolume != null && options.minVolume > 0) {
    rows = rows.filter((r) => r.totalVolumeFp >= options.minVolume!);
  }
  rows = rows.sort((a, b) => b.totalVolumeFp - a.totalVolumeFp).slice(0, options.top ?? 10);
  const tickers = rows.flatMap((r) => r.legs.map((l) => l.ticker));
  const record = await recordKalshiBookTicks(db, tickers, { syncFirst: options.syncFirst ?? true });
  return { rows, record };
}

export async function syncAndRecordOpenItfBooks(
  db: Database,
  options: { minVolume?: number } = {},
): Promise<{ sync: ItfSyncSummary; record: RecordBookTickSummary }> {
  const sync = await syncOpenItfEvents(db);
  const markets = await fetchOpenItfMarkets();
  let rows = buildItfCalendarRows(markets);
  if (options.minVolume != null && options.minVolume > 0) {
    const floor = options.minVolume;
    rows = rows.filter((r) => r.totalVolumeFp >= floor);
  }
  const tickers = rows.flatMap((r) => r.legs.map((l) => l.ticker));
  const record = await recordKalshiBookTicks(db, tickers);
  return { sync, record };
}

/** Fetch orderbooks (depth≥3) and attach top-3 resting size onto calendar legs. */
export async function enrichItfCalendarDepth(
  rows: ItfCalendarRow[],
  options: {
    fetchBook?: typeof fetchKalshiBookSnapshot;
    depth?: number;
  } = {},
): Promise<{ rows: ItfCalendarRow[]; polled: number; errors: number }> {
  const fetchBook = options.fetchBook ?? fetchKalshiBookSnapshot;
  const depth = options.depth ?? 3;
  let polled = 0;
  let errors = 0;
  for (const row of rows) {
    for (const leg of row.legs) {
      polled++;
      try {
        const book = await fetchBook(leg.ticker, { depth });
        attachItfLegBookDepth(leg, book);
      } catch {
        errors++;
      }
    }
  }
  return { rows, polled, errors };
}
