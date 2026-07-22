import type { KalshiMarketWire } from "../../bot/kalshi-events-api.ts";
import type { BookSnapshot } from "../alpha-signal-types.ts";
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
  /** Trailing 24h contract volume (flow). */
  volume24hFp: number;
  /** Resting contracts at best YES bid (market list). */
  yesBidSize: number;
  /** Resting contracts at best YES ask (market list). */
  yesAskSize: number;
  /** Sum of top-3 bid sizes when orderbook-enriched; else null. */
  bidDepthTop3: number | null;
  /** Sum of top-3 ask sizes when orderbook-enriched; else null. */
  askDepthTop3: number | null;
  competitorId: string | null;
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
  /** Event-level trailing 24h contract volume — pilot capacity input. */
  totalVolume24hFp: number;
  legs: ItfCalendarLeg[];
  /** Side label with highest mid price. */
  favoriteLabel: string | null;
  favoriteMidCents: number | null;
  underdogLabel: string | null;
  underdogMidCents: number | null;
  /** Favorite bid/ask spread in cents (null if either side missing). */
  favoriteSpreadCents: number | null;
  /** Underdog resting ask size — what gates underdog-leg fills. */
  underdogAskSize: number;
  /** Favorite resting ask size. */
  favoriteAskSize: number;
  /**
   * Higher = closer to fee-aware watch zone (mid-price 30–70¢ / underdog legs).
   * Deep-tail favorites score low.
   */
  tradableScore: number;
  status: string;
};

export type ItfCalendarStats = {
  openLegs: number;
  openEvents: number;
  bySeries: Record<string, number>;
  byDate: Record<string, number>;
  totalVolumeFp: number;
  totalVolume24hFp: number;
};

export type ItfCalendarSort = "tradable" | "time" | "volume" | "flow";

export type ItfCalendarFilter = {
  date?: string;
  series?: ItfSeriesTicker | string;
  minVolume?: number;
  minVolume24h?: number;
  /** Prefer mid-band / underdog (default). */
  sort?: ItfCalendarSort;
  limit?: number;
};

/** Mid-price band where fee-aware edge is verifiable — not deep-tail favorites. */
export const ITF_TRADABLE_MID_LO = 30;
export const ITF_TRADABLE_MID_HI = 70;

function dollarsToCents(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function fpContracts(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function midCents(bid: number | null, ask: number | null): number | null {
  if (bid == null && ask == null) return null;
  if (bid == null) return ask;
  if (ask == null) return bid;
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
    volumeFp: fpContracts(m.volume_fp),
    volume24hFp: fpContracts(m.volume_24h_fp),
    yesBidSize: fpContracts(m.yes_bid_size_fp),
    yesAskSize: fpContracts(m.yes_ask_size_fp),
    bidDepthTop3: null,
    askDepthTop3: null,
    competitorId: m.custom_strike?.tennis_competitor ?? null,
    status: m.status,
  };
}

function topNSize(levels: Array<{ size: number }> | undefined, n: number): number {
  if (!levels?.length) return 0;
  return levels.slice(0, n).reduce((s, l) => s + l.size, 0);
}

/** Attach top-3 resting depth from orderbook snapshots (mutates legs). */
export function attachItfLegBookDepth(leg: ItfCalendarLeg, book: BookSnapshot): void {
  leg.bidDepthTop3 = topNSize(book.bids, 3);
  leg.askDepthTop3 = topNSize(book.asks, 3);
}

export function computeTradableScore(row: {
  favoriteMidCents: number | null;
  underdogMidCents: number | null;
  favoriteSpreadCents: number | null;
  totalVolume24hFp: number;
  underdogAskSize: number;
}): number {
  let score = 0;
  const fav = row.favoriteMidCents;
  const und = row.underdogMidCents;
  if (fav != null && fav >= ITF_TRADABLE_MID_LO && fav <= ITF_TRADABLE_MID_HI) {
    score += 100;
  } else if (fav != null && fav > ITF_TRADABLE_MID_HI && fav <= 85) {
    score += 40;
  } else if (fav != null && fav > 85) {
    score -= 50;
  }
  if (und != null && und >= 4 && und <= 25) score += 30;
  if (row.favoriteSpreadCents != null && row.favoriteSpreadCents >= 3 && (fav ?? 0) >= 90) {
    score -= 15; // transaction-cost wall on deep favorites
  }
  score += Math.min(50, Math.log10(1 + row.totalVolume24hFp) * 15);
  score += Math.min(20, Math.log10(1 + row.underdogAskSize) * 8);
  return score;
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
    let favoriteSpreadCents: number | null = null;
    let favoriteAskSize = 0;
    let underdogLabel: string | null = null;
    let underdogMidCents: number | null = null;
    let underdogAskSize = 0;

    for (const leg of legs) {
      const mid = midCents(leg.yesBidCents, leg.yesAskCents);
      if (mid == null) continue;
      if (favoriteMidCents == null || mid > favoriteMidCents) {
        favoriteMidCents = mid;
        favoriteLabel = leg.label;
        favoriteAskSize = leg.yesAskSize;
        favoriteSpreadCents =
          leg.yesBidCents != null && leg.yesAskCents != null
            ? leg.yesAskCents - leg.yesBidCents
            : null;
      }
      if (underdogMidCents == null || mid < underdogMidCents) {
        underdogMidCents = mid;
        underdogLabel = leg.label;
        underdogAskSize = leg.yesAskSize;
      }
    }

    const totalVolumeFp = legs.reduce((s, l) => s + l.volumeFp, 0);
    const totalVolume24hFp = legs.reduce((s, l) => s + l.volume24hFp, 0);
    const draft = {
      favoriteMidCents,
      underdogMidCents,
      favoriteSpreadCents,
      totalVolume24hFp,
      underdogAskSize,
    };

    rows.push({
      eventTicker,
      series,
      tour: itfTourFromSeries(series),
      matchup,
      startTs,
      startDate: startTs.slice(0, 10),
      marketCount: eventMarkets.length,
      totalVolumeFp,
      totalVolume24hFp,
      legs,
      favoriteLabel,
      favoriteMidCents,
      underdogLabel,
      underdogMidCents,
      favoriteSpreadCents,
      underdogAskSize,
      favoriteAskSize,
      tradableScore: computeTradableScore(draft),
      status: eventMarkets.every((m) => m.status === "active") ? "active" : sample.status,
    });
  }

  return rows;
}

export function summarizeItfCalendar(rows: ItfCalendarRow[], openLegs: number): ItfCalendarStats {
  const bySeries: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  let totalVolumeFp = 0;
  let totalVolume24hFp = 0;
  for (const row of rows) {
    bySeries[row.series] = (bySeries[row.series] ?? 0) + 1;
    byDate[row.startDate] = (byDate[row.startDate] ?? 0) + 1;
    totalVolumeFp += row.totalVolumeFp;
    totalVolume24hFp += row.totalVolume24hFp;
  }
  return {
    openLegs,
    openEvents: rows.length,
    bySeries,
    byDate,
    totalVolumeFp,
    totalVolume24hFp,
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
  if (filter.minVolume24h != null && filter.minVolume24h > 0) {
    out = out.filter((r) => r.totalVolume24hFp >= filter.minVolume24h!);
  }
  const sort = filter.sort ?? "tradable";
  out = [...out].sort((a, b) => {
    if (sort === "volume") return b.totalVolumeFp - a.totalVolumeFp || a.startTs.localeCompare(b.startTs);
    if (sort === "flow") {
      return b.totalVolume24hFp - a.totalVolume24hFp || b.tradableScore - a.tradableScore || a.startTs.localeCompare(b.startTs);
    }
    if (sort === "time") {
      return a.startTs.localeCompare(b.startTs) || b.tradableScore - a.tradableScore;
    }
    // tradable (default): mid-band / underdog first, then daily flow
    return (
      b.tradableScore - a.tradableScore ||
      b.totalVolume24hFp - a.totalVolume24hFp ||
      a.startTs.localeCompare(b.startTs)
    );
  });
  if (filter.limit != null && filter.limit > 0) {
    out = out.slice(0, filter.limit);
  }
  return out;
}

export function topItfEventsByVolume(rows: ItfCalendarRow[], n: number): ItfCalendarRow[] {
  return [...rows].sort((a, b) => b.totalVolumeFp - a.totalVolumeFp).slice(0, n);
}

export function topItfEventsByFlow(rows: ItfCalendarRow[], n: number): ItfCalendarRow[] {
  return [...rows].sort((a, b) => b.totalVolume24hFp - a.totalVolume24hFp).slice(0, n);
}

export function tickersForEvents(rows: ItfCalendarRow[]): string[] {
  return rows.flatMap((r) => r.legs.map((l) => l.ticker));
}

export { ITF_SERIES_TICKERS, playerLabels };
