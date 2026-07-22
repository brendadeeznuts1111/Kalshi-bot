import type { KalshiMarketWire } from "../../bot/kalshi-events-api.ts";
import {
  ITF_SERIES_TICKERS,
  type ItfSeriesTicker,
  itfTourFromSeries,
  parseItfSeriesPrefix,
  parseItfYesSideCode,
} from "../../alpha/ticker-formats/itf.ts";

export type ItfCalendarLeg = {
  ticker: string;
  sideCode: string;
  label: string;
  yesBidCents: number | null;
  yesAskCents: number | null;
  volumeFp: number;
  status: string;
};

export type ItfCalendarRow = {
  eventTicker: string;
  series: string;
  tour: string;
  /** e.g. "Dong / Markovina vs Delaney / Ho Yap" */
  matchup: string;
  startTs: string;
  startDate: string;
  marketCount: number;
  totalVolumeFp: number;
  legs: ItfCalendarLeg[];
  /** Side label with highest mid price. */
  favoriteLabel: string | null;
  favoriteMidCents: number | null;
  status: string;
};

export type ItfCalendarStats = {
  openLegs: number;
  openEvents: number;
  bySeries: Record<string, number>;
  byDate: Record<string, number>;
  totalVolumeFp: number;
};

export type ItfCalendarFilter = {
  date?: string;
  series?: ItfSeriesTicker | string;
  minVolume?: number;
  sort?: "time" | "volume";
  limit?: number;
};

function dollarsToCents(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function midCents(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null) return bid ?? ask;
  return Math.round((bid + ask) / 2);
}

function playerLabels(markets: KalshiMarketWire[]): [string, string] | null {
  const labels = markets
    .map((m) => m.yes_sub_title?.trim())
    .filter((v): v is string => Boolean(v));
  const unique = [...new Set(labels)];
  if (unique.length < 2) return null;
  const sorted = unique.sort((a, b) => a.localeCompare(b));
  return [sorted[0]!, sorted[1]!];
}

export function groupMarketsByEvent(markets: KalshiMarketWire[]): Map<string, KalshiMarketWire[]> {
  const map = new Map<string, KalshiMarketWire[]>();
  for (const m of markets) {
    const list = map.get(m.event_ticker) ?? [];
    list.push(m);
    map.set(m.event_ticker, list);
  }
  return map;
}

function legFromMarket(m: KalshiMarketWire): ItfCalendarLeg {
  return {
    ticker: m.ticker,
    sideCode: parseItfYesSideCode(m.ticker) ?? "",
    label: m.yes_sub_title ?? m.ticker,
    yesBidCents: dollarsToCents(m.yes_bid_dollars),
    yesAskCents: dollarsToCents(m.yes_ask_dollars),
    volumeFp: Number(m.volume_fp ?? 0),
    status: m.status,
  };
}

export function buildItfCalendarRows(markets: KalshiMarketWire[]): ItfCalendarRow[] {
  const grouped = groupMarketsByEvent(markets);
  const rows: ItfCalendarRow[] = [];

  for (const [eventTicker, eventMarkets] of grouped) {
    const sample = eventMarkets[0]!;
    const series = parseItfSeriesPrefix(sample.ticker) ?? "ITF";
    const startTs = sample.occurrence_datetime ?? sample.expected_expiration_time ?? "";
    const legs = eventMarkets.map(legFromMarket).sort((a, b) => b.volumeFp - a.volumeFp);
    const labels = playerLabels(eventMarkets);
    const matchup = labels ? `${labels[0]} vs ${labels[1]}` : eventTicker;

    let favoriteLabel: string | null = null;
    let favoriteMidCents: number | null = null;
    for (const leg of legs) {
      const mid = midCents(leg.yesBidCents, leg.yesAskCents);
      if (mid == null) continue;
      if (favoriteMidCents == null || mid > favoriteMidCents) {
        favoriteMidCents = mid;
        favoriteLabel = leg.label;
      }
    }

    rows.push({
      eventTicker,
      series,
      tour: itfTourFromSeries(series),
      matchup,
      startTs,
      startDate: startTs.slice(0, 10),
      marketCount: eventMarkets.length,
      totalVolumeFp: legs.reduce((s, l) => s + l.volumeFp, 0),
      legs,
      favoriteLabel,
      favoriteMidCents,
      status: eventMarkets.every((m) => m.status === "active") ? "active" : sample.status,
    });
  }

  return rows;
}

export function summarizeItfCalendar(rows: ItfCalendarRow[], openLegs: number): ItfCalendarStats {
  const bySeries: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  let totalVolumeFp = 0;
  for (const row of rows) {
    bySeries[row.series] = (bySeries[row.series] ?? 0) + 1;
    byDate[row.startDate] = (byDate[row.startDate] ?? 0) + 1;
    totalVolumeFp += row.totalVolumeFp;
  }
  return {
    openLegs,
    openEvents: rows.length,
    bySeries,
    byDate,
    totalVolumeFp,
  };
}

export function filterItfCalendarRows(rows: ItfCalendarRow[], filter: ItfCalendarFilter): ItfCalendarRow[] {
  let out = rows;
  if (filter.date) {
    out = out.filter((r) => r.startDate === filter.date || r.startTs.startsWith(filter.date!));
  }
  if (filter.series) {
    out = out.filter((r) => r.series === filter.series);
  }
  if (filter.minVolume != null && filter.minVolume > 0) {
    out = out.filter((r) => r.totalVolumeFp >= filter.minVolume!);
  }
  const sort = filter.sort ?? "time";
  out = [...out].sort((a, b) => {
    if (sort === "volume") return b.totalVolumeFp - a.totalVolumeFp || a.startTs.localeCompare(b.startTs);
    return a.startTs.localeCompare(b.startTs) || b.totalVolumeFp - a.totalVolumeFp;
  });
  if (filter.limit != null && filter.limit > 0) {
    out = out.slice(0, filter.limit);
  }
  return out;
}

export function topItfEventsByVolume(rows: ItfCalendarRow[], n: number): ItfCalendarRow[] {
  return [...rows].sort((a, b) => b.totalVolumeFp - a.totalVolumeFp).slice(0, n);
}

export function tickersForEvents(rows: ItfCalendarRow[]): string[] {
  return rows.flatMap((r) => r.legs.map((l) => l.ticker));
}

export { ITF_SERIES_TICKERS, playerLabels };
