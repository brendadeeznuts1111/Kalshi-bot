// @see https://docs.kalshi.com/api-reference/market/get-markets
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
import type { CanonicalEventId } from "./types.ts";
import type { BookSnapshot } from "../alpha-signal-types.ts";
import { fetchKalshiBookSnapshot } from "../../bot/kalshi-market-data.ts";
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
const KALSHI_SOURCE = "kalshi-api";
const KALSHI_MARKETS_URL = `${OFFICIAL_URLS.kalshi.tradeApiV2Base}/markets`;
const KALSHI_ORDERBOOK_URL = (ticker: string) =>
  `${OFFICIAL_URLS.kalshi.tradeApiV2Base}/markets/${encodeURIComponent(ticker)}/orderbook`;
const TRADING_CORPUS = "trading";

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
  for (const m of markets) byTicker.set(m.ticker, m);
  return [...byTicker.values()];
}

export async function fetchOpenItfMarkets(
  options: ItfFetchOptions = {},
): Promise<KalshiMarketWire[]> {
  // Sequential — parallel series fan-out trips public rate limits.
  const out: KalshiMarketWire[] = [];
  for (const series of ITF_SERIES_TICKERS) {
    out.push(
      ...(await fetchAllKalshiMarketsRetry({ series_ticker: series, status: "open" }, options)),
    );
  }
  return out;
}

export type RetainedItfMarkets = {
  markets: KalshiMarketWire[];
  byStatus: ItfMarketsByStatus;
};

/**
 * Open ITF markets plus closed/settled within retainDays (default 3).
 * Sequential per series × status — rate-limit safe. Dedupes by market ticker.
 */
export async function fetchRetainedItfMarkets(
  options: ItfFetchOptions & { retainDays?: number } = {},
): Promise<RetainedItfMarkets> {
  const retainDays = options.retainDays ?? DEFAULT_ITF_RETAIN_DAYS;
  if (retainDays <= 0) {
    const open = await fetchOpenItfMarkets(options);
    return { markets: open, byStatus: { open: open.length, closed: 0, settled: 0 } };
  }
  const nowMs = options.nowMs ?? Date.now();
  const minTs = Math.floor(nowMs / 1000) - Math.floor(retainDays * 86_400);
  const open: KalshiMarketWire[] = [];
  const closed: KalshiMarketWire[] = [];
  const settled: KalshiMarketWire[] = [];
  // Sequential — parallel series fan-out trips public rate limits.
  for (const series of ITF_SERIES_TICKERS) {
    open.push(
      ...(await fetchAllKalshiMarketsRetry({ series_ticker: series, status: "open" }, options)),
    );
    closed.push(
      ...(await fetchAllKalshiMarketsRetry(
        { series_ticker: series, status: "closed", min_close_ts: minTs },
        options,
      )),
    );
    settled.push(
      ...(await fetchAllKalshiMarketsRetry(
        { series_ticker: series, status: "settled", min_settled_ts: minTs },
        options,
      )),
    );
  }
  return {
    markets: dedupeMarketsByTicker([...open, ...closed, ...settled]),
    byStatus: { open: open.length, closed: closed.length, settled: settled.length },
  };
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

export async function fetchItfCalendarRow(eventTicker: string): Promise<ItfCalendarRow | null> {
  const markets = await fetchOpenItfMarkets();
  const rows = buildItfCalendarRows(markets.filter((m) => m.event_ticker === eventTicker));
  return rows[0] ?? null;
}

export type UpsertKalshiEventResult =
  | { ok: true; eventId: CanonicalEventId; keyedBy: "competitors" | "ticker" }
  | { ok: false; anomaly: string };

function upsertKalshiEvent(
  db: Database,
  eventTicker: string,
  markets: KalshiMarketWire[],
  eventTitle: string,
  eventSubTitle: string,
  ingestedAt: number,
): UpsertKalshiEventResult {
  const sample = markets[0]!;
  const series = parseItfSeriesPrefix(sample.ticker) ?? "KXITFMATCH";
  const labels = playerLabels(markets);
  const sideCodes = itfSideCodesForEvent(
    eventTicker,
    markets.map((m) => m.ticker),
  );
  if (!sideCodes) {
    return {
      ok: false,
      anomaly: `ambiguous_itf_blob:${eventTicker} — refuse best-guess side split`,
    };
  }
  const startTs = sample.occurrence_datetime?.trim() ?? "";
  if (!startTs) {
    return {
      ok: false,
      anomaly: `missing_occurrence:${eventTicker} — refuse expected_expiration / wall-clock mint`,
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
      anomaly: `ticker_keyed_event_id:${eventTicker} — missing tennis_competitor pair; refuse trading upsert`,
    };
  }
  const sourceRowHash = kalshiSourceRowHash(eventTicker);
  // Stable venue row: reuse prior event_id when occurrence drifts a minute (hash is ticker-only).
  const prior = db
    .query(`SELECT event_id AS eventId FROM events WHERE source_row_hash = $hash`)
    .get({ $hash: sourceRowHash }) as { eventId: string } | null;
  const eventId = (prior?.eventId as CanonicalEventId | undefined) ?? minted.eventId;
  const keyedBy = minted.keyedBy;
  const playerA = labels?.[0] ?? sideCodes[0]!;
  const playerB = labels?.[1] ?? sideCodes[1]!;
  const rules = parseRulesBlob(markets);
  const settlement = settlementFromKalshiMarkets(markets);
  const winner = settlement?.winner ?? "";
  const loser = settlement?.loser ?? "";
  const outcome = settlement?.outcome ?? "scheduled";

  // Preserve bridged Stadion winner/outcome/score_text across re-sync (INSERT OR REPLACE wiped them).
  // When no bridge yet, closed/settled Kalshi result fills winner/outcome via excluded.*.
  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, score_text, source, source_url, fetched_ts,
      source_row_hash, ingested_at, corpus
    ) VALUES (
      $event_id, $tour, $level, $tournament, '', 'unknown', '', $round, NULL,
      $player_a, $player_b, $winner, $loser, $start_ts, $outcome, '', $source, $source_url, $fetched_ts,
      $source_row_hash, $ingested_at, $corpus
    )
    ON CONFLICT (event_id) DO UPDATE SET
      tour = excluded.tour,
      level = excluded.level,
      tournament = excluded.tournament,
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
    $event_id: eventId,
    $tour: itfTourFromSeries(series),
    $level: eventSubTitle || series,
    $tournament: extractTournament(eventTitle, eventSubTitle),
    $round: extractRound(eventTitle, rules),
    $player_a: playerA,
    $player_b: playerB,
    $winner: winner,
    $loser: loser,
    $start_ts: startTs,
    $outcome: outcome,
    $source: KALSHI_SOURCE,
    $source_url: `${KALSHI_MARKETS_URL}?event_ticker=${encodeURIComponent(eventTicker)}`,
    $fetched_ts: ingestedAt,
    $source_row_hash: sourceRowHash,
    $ingested_at: ingestedAt,
    $corpus: TRADING_CORPUS,
  });

  for (const m of markets) {
    const sideCode = parseItfYesSideCode(m.ticker) ?? "";
    const mSeries = parseTennisSeriesPrefix(m.ticker) ?? series;
    db.query(
      `INSERT OR REPLACE INTO markets (
        market_id, event_id, venue, ticker, series, market_kind, yes_side_label, side_code,
        competitor_id, rules_blob, settlement_ts, source, source_url, fetched_ts
      ) VALUES (
        $market_id, $event_id, $venue, $ticker, $series, $market_kind, $yes_side_label, $side_code,
        $competitor_id, $rules_blob, NULL, $source, $source_url, $fetched_ts
      )`,
    ).run({
      $market_id: kalshiMarketId(m.ticker),
      $event_id: eventId,
      $venue: KALSHI_VENUE,
      $ticker: m.ticker,
      $series: mSeries,
      $market_kind: marketKindFromTicker(m.ticker),
      $yes_side_label: m.yes_sub_title ?? "",
      $side_code: sideCode,
      $competitor_id: m.custom_strike?.tennis_competitor ?? null,
      $rules_blob: rules,
      $source: KALSHI_SOURCE,
      $source_url: `${KALSHI_MARKETS_URL}?ticker=${encodeURIComponent(m.ticker)}`,
      $fetched_ts: ingestedAt,
    });
  }

  return { ok: true, eventId, keyedBy };
}

/** Open markets across the ladder family that share this matchup date-blob. */
export async function fetchLadderMarketsForEvent(
  eventTickerOrMarket: string,
): Promise<{ markets: KalshiMarketWire[]; coverage: LadderCoverage }> {
  const blob = extractMatchupDateBlob(eventTickerOrMarket);
  const family = ladderFamilyFromTicker(eventTickerOrMarket);
  const seriesList = ladderSeriesForTicker(eventTickerOrMarket);
  if (!blob || seriesList.length === 0) {
    return {
      markets: [],
      coverage: summarizeLadderCoverage(family, blob, []),
    };
  }
  // Sequential — parallel fan-out across ~20 ATP ladder series trips public rate limits.
  const markets: KalshiMarketWire[] = [];
  for (const series of seriesList) {
    try {
      const batch = await fetchAllKalshiMarketsRetry({ series_ticker: series, status: "open" }, {});
      for (const m of batch) {
        const mBlob = extractMatchupDateBlob(m.event_ticker) ?? extractMatchupDateBlob(m.ticker);
        if (mBlob === blob) markets.push(m);
      }
    } catch {
      // One series 429/empty must not abort the whole ladder poll.
    }
  }
  const tickers = markets.map((m) => m.ticker);
  return { markets, coverage: summarizeLadderCoverage(family, blob, tickers) };
}

export type SyncItfEventsOptions = ItfFetchOptions & {
  fetchEventDetails?: boolean;
  eventTickers?: string[];
  /**
   * Days of closed/settled markets to retain (default 3).
   * `0` = open-only (legacy behavior).
   */
  retainDays?: number;
};

export async function syncItfEvents(
  db: Database,
  options: SyncItfEventsOptions = {},
): Promise<ItfSyncSummary> {
  const retainDays = options.retainDays ?? DEFAULT_ITF_RETAIN_DAYS;
  const retained = await fetchRetainedItfMarkets({
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    nowMs: options.nowMs,
    retainDays,
  });
  const markets = retained.markets;
  let grouped = groupMarketsByEvent(markets);
  if (options.eventTickers?.length) {
    const allow = new Set(options.eventTickers);
    grouped = new Map([...grouped.entries()].filter(([k]) => allow.has(k)));
  }
  const ingestedAt = options.nowMs ?? Date.now();
  let eventsUpserted = 0;
  let marketsUpserted = 0;
  let eventsSkipped = 0;
  const anomalies: string[] = [];

  db.run("BEGIN");
  try {
    for (const [eventTicker, eventMarkets] of grouped) {
      let title = eventTicker;
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
    seriesScanned: ITF_SERIES_TICKERS.length,
    marketsSeen: markets.length,
    marketsSeenByStatus: retained.byStatus,
    retainDays,
    eventsUpserted,
    marketsUpserted,
    eventsSkipped,
    anomalies,
  };
}

/** @deprecated Prefer `syncItfEvents` — retainDays defaults to 3; pass `retainDays: 0` for open-only. */
export async function syncOpenItfEvents(
  db: Database,
  options: SyncItfEventsOptions = {},
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
  tickers: string[],
  options: {
    fetchBook?: typeof fetchKalshiBookSnapshot;
    syncFirst?: boolean;
    coverage?: LadderCoverage;
  } = {},
): Promise<RecordBookTickSummary> {
  const fetchBook = options.fetchBook ?? fetchKalshiBookSnapshot;
  let ticksRecorded = 0;
  let errors = 0;
  const eventTickers = new Set<string>();

  if (options.syncFirst && tickers.length > 0) {
    const events = tickers
      .map((t) => parseItfEventTicker(t))
      .filter((e): e is string => Boolean(e));
    if (events.length) {
      await syncOpenItfEvents(db, { eventTickers: [...new Set(events)] });
    }
  }

  for (const ticker of tickers) {
    const eventTicker = parseItfEventTicker(ticker) ?? ticker.replace(/-[A-Z0-9]+$/, "");
    eventTickers.add(eventTicker);
    const mapped = db
      .query(`SELECT event_id AS eventId FROM markets WHERE ticker = $ticker`)
      .get({ $ticker: ticker }) as { eventId: string } | null;
    if (!mapped?.eventId) {
      // Never ticker-mint phantom event_ids — book_ticks must join synced markets.
      errors++;
      continue;
    }
    const eventId = mapped.eventId as CanonicalEventId;
    const kind = marketKindFromTicker(ticker);
    try {
      const book: BookSnapshot = await fetchBook(ticker);
      // Per-ticker wall clock after REST response — not one stamp for the whole pass.
      const recvTs = Date.now();
      db.query(
        `INSERT INTO book_ticks (
           event_id, ticker, market_kind, ts, recv_ts, source_clock, seq, levels_json, source, source_url
         ) VALUES (
           $event_id, $ticker, $market_kind, $ts, $recv_ts, 'recv', NULL, $levels_json, 'kalshi-rest', $source_url
         )`,
      ).run({
        $event_id: eventId,
        $ticker: ticker,
        $market_kind: kind,
        $ts: recvTs,
        $recv_ts: recvTs,
        $levels_json: JSON.stringify(book),
        $source_url: KALSHI_ORDERBOOK_URL(ticker),
      });
      ticksRecorded++;
    } catch {
      errors++;
    }
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
  eventTicker: string,
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
