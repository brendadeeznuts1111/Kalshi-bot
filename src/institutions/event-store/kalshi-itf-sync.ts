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
  type KalshiMarketWire,
} from "../../bot/kalshi-events-api.ts";
import {
  buildItfCalendarRows,
  groupMarketsByEvent,
  playerLabels,
  type ItfCalendarRow,
} from "./itf-calendar.ts";
import { kalshiMarketId, kalshiSourceRowHash, mintKalshiEventId } from "./kalshi-event-id.ts";
import type { CanonicalEventId } from "./types.ts";
import type { BookSnapshot } from "../alpha-signal-types.ts";
import { fetchKalshiBookSnapshot } from "../../bot/kalshi-market-data.ts";

export type { ItfCalendarLeg, ItfCalendarRow, ItfCalendarStats, ItfCalendarFilter } from "./itf-calendar.ts";
export {
  buildItfCalendarRows,
  filterItfCalendarRows,
  summarizeItfCalendar,
  topItfEventsByVolume,
  tickersForEvents,
  groupMarketsByEvent,
} from "./itf-calendar.ts";

export type ItfSyncSummary = {
  seriesScanned: number;
  marketsSeen: number;
  eventsUpserted: number;
  marketsUpserted: number;
};

const KALSHI_VENUE = "kalshi";
const KALSHI_SOURCE = "kalshi-api";

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

export async function fetchOpenItfMarkets(): Promise<KalshiMarketWire[]> {
  const batches = await Promise.all(
    ITF_SERIES_TICKERS.map((series) =>
      fetchAllKalshiMarkets({ series_ticker: series, status: "open" }),
    ),
  );
  return batches.flat();
}

export async function fetchItfCalendarRow(eventTicker: string): Promise<ItfCalendarRow | null> {
  const markets = await fetchOpenItfMarkets();
  const rows = buildItfCalendarRows(markets.filter((m) => m.event_ticker === eventTicker));
  return rows[0] ?? null;
}

function upsertKalshiEvent(
  db: Database,
  eventTicker: string,
  markets: KalshiMarketWire[],
  eventTitle: string,
  eventSubTitle: string,
  ingestedAt: number,
): CanonicalEventId {
  const sample = markets[0]!;
  const series = parseItfSeriesPrefix(sample.ticker) ?? "KXITFMATCH";
  const eventId = mintKalshiEventId(eventTicker);
  const labels = playerLabels(markets);
  const sideCodes = itfSideCodesForEvent(
    eventTicker,
    markets.map((m) => m.ticker),
  );
  const playerA = labels?.[0] ?? sideCodes?.[0] ?? "unknown-a";
  const playerB = labels?.[1] ?? sideCodes?.[1] ?? "unknown-b";
  const startTs = sample.occurrence_datetime ?? sample.expected_expiration_time ?? new Date().toISOString();
  const rules = parseRulesBlob(markets);

  db.query(
    `INSERT OR REPLACE INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, source, source_row_hash, ingested_at
    ) VALUES (
      $event_id, $tour, $level, $tournament, '', 'unknown', '', $round, NULL,
      $player_a, $player_b, '', '', $start_ts, 'scheduled', $source, $source_row_hash, $ingested_at
    )`,
  ).run({
    $event_id: eventId,
    $tour: itfTourFromSeries(series),
    $level: eventSubTitle || series,
    $tournament: extractTournament(eventTitle, eventSubTitle),
    $round: extractRound(eventTitle, rules),
    $player_a: playerA,
    $player_b: playerB,
    $start_ts: startTs,
    $source: KALSHI_SOURCE,
    $source_row_hash: kalshiSourceRowHash(eventTicker),
    $ingested_at: ingestedAt,
  });

  for (const m of markets) {
    const sideCode = parseItfYesSideCode(m.ticker) ?? "";
    db.query(
      `INSERT OR REPLACE INTO markets (
        market_id, event_id, venue, ticker, yes_side_label, side_code, competitor_id, rules_blob, settlement_ts
      ) VALUES (
        $market_id, $event_id, $venue, $ticker, $yes_side_label, $side_code, $competitor_id, $rules_blob, NULL
      )`,
    ).run({
      $market_id: kalshiMarketId(m.ticker),
      $event_id: eventId,
      $venue: KALSHI_VENUE,
      $ticker: m.ticker,
      $yes_side_label: m.yes_sub_title ?? "",
      $side_code: sideCode,
      $competitor_id: m.custom_strike?.tennis_competitor ?? null,
      $rules_blob: rules,
    });
  }

  return eventId;
}

export async function syncOpenItfEvents(
  db: Database,
  options: { fetchEventDetails?: boolean; eventTickers?: string[] } = {},
): Promise<ItfSyncSummary> {
  const markets = await fetchOpenItfMarkets();
  let grouped = groupMarketsByEvent(markets);
  if (options.eventTickers?.length) {
    const allow = new Set(options.eventTickers);
    grouped = new Map([...grouped.entries()].filter(([k]) => allow.has(k)));
  }
  const ingestedAt = Date.now();
  let eventsUpserted = 0;
  let marketsUpserted = 0;

  db.run("BEGIN");
  try {
    for (const [eventTicker, eventMarkets] of grouped) {
      let title = eventTicker;
      let subTitle = "";
      let marketsForEvent = eventMarkets;
      if (options.fetchEventDetails) {
        try {
          const detail = await fetchKalshiEvent(eventTicker);
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
      upsertKalshiEvent(db, eventTicker, marketsForEvent, title, subTitle, ingestedAt);
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
    eventsUpserted,
    marketsUpserted,
  };
}

export type RecordBookTickSummary = {
  ticksRecorded: number;
  marketsPolled: number;
  errors: number;
  eventCount: number;
};

export async function recordKalshiBookTicks(
  db: Database,
  tickers: string[],
  options: { fetchBook?: typeof fetchKalshiBookSnapshot; syncFirst?: boolean } = {},
): Promise<RecordBookTickSummary> {
  const fetchBook = options.fetchBook ?? fetchKalshiBookSnapshot;
  const ts = Date.now();
  let ticksRecorded = 0;
  let errors = 0;
  const eventTickers = new Set<string>();

  if (options.syncFirst && tickers.length > 0) {
    const events = tickers
      .map((t) => parseItfEventTicker(t))
      .filter((e): e is string => Boolean(e));
    await syncOpenItfEvents(db, { eventTickers: [...new Set(events)] });
  }

  for (const ticker of tickers) {
    const eventTicker = parseItfEventTicker(ticker);
    if (!eventTicker) {
      errors++;
      continue;
    }
    eventTickers.add(eventTicker);
    const eventId = mintKalshiEventId(eventTicker);
    try {
      const book: BookSnapshot = await fetchBook(ticker);
      db.query(
        `INSERT INTO book_ticks (event_id, ticker, ts, seq, levels_json, source)
         VALUES ($event_id, $ticker, $ts, NULL, $levels_json, 'kalshi-rest')`,
      ).run({
        $event_id: eventId,
        $ticker: ticker,
        $ts: ts,
        $levels_json: JSON.stringify(book),
      });
      ticksRecorded++;
    } catch {
      errors++;
    }
  }

  return {
    ticksRecorded,
    marketsPolled: tickers.length,
    errors,
    eventCount: eventTickers.size,
  };
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
