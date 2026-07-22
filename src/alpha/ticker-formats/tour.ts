/** Kalshi ATP/WTA tour match series — match winner for mapper baseline. */
import {
  isKalshiTickerInSeries,
  matchupBlobIsUnambiguous,
  parseEventTicker,
  parseMatchupBlob,
  parseSeriesPrefix,
  parseYesSideCode,
  sideCodesForEvent,
  splitMatchupBlob,
} from "./series-parse.ts";

export const TOUR_SERIES_TICKERS = ["KXATPMATCH", "KXWTAMATCH"] as const;

export type TourSeriesTicker = (typeof TOUR_SERIES_TICKERS)[number];

export function isTourSeriesTicker(value: string): value is TourSeriesTicker {
  return (TOUR_SERIES_TICKERS as readonly string[]).includes(value);
}

export function isTourKalshiTicker(ticker: string): boolean {
  return isKalshiTickerInSeries(ticker, TOUR_SERIES_TICKERS);
}

export function parseTourSeriesPrefix(ticker: string): string | null {
  return parseSeriesPrefix(ticker, TOUR_SERIES_TICKERS);
}

/** YES side code suffix (e.g. BOR, BUR). */
export function parseTourYesSideCode(ticker: string): string | null {
  return parseYesSideCode(ticker, TOUR_SERIES_TICKERS);
}

/** Matchup blob between date prefix and side suffix (e.g. BORBUR). */
export function parseTourMatchupBlob(ticker: string): string | null {
  return parseMatchupBlob(ticker, TOUR_SERIES_TICKERS);
}

export function parseTourEventTicker(ticker: string): string | null {
  return parseEventTicker(ticker, TOUR_SERIES_TICKERS);
}

/** Ambiguous prefix∩suffix partitions hard-fail (null) — never best-guess. */
export function splitTourMatchupBlob(blob: string, yesSideCode: string): [string, string] | null {
  return splitMatchupBlob(blob, yesSideCode);
}

export function tourMatchupBlobIsUnambiguous(blob: string, codeA: string, codeB: string): boolean {
  return matchupBlobIsUnambiguous(blob, codeA, codeB);
}

/** Hard-fail (null) when the matchup blob cannot be uniquely partitioned. */
export function tourSideCodesForEvent(eventTicker: string, marketTickers: string[]): [string, string] | null {
  return sideCodesForEvent(TOUR_SERIES_TICKERS, eventTicker, marketTickers);
}

export function tourFromSeries(series: string): "ATP" | "WTA" | "TOUR" {
  switch (series) {
    case "KXATPMATCH":
      return "ATP";
    case "KXWTAMATCH":
      return "WTA";
    default:
      return "TOUR";
  }
}

export function tourFormatLabel(series: string): "atp-match" | "wta-match" {
  return series === "KXWTAMATCH" ? "wta-match" : "atp-match";
}
