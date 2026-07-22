/** Kalshi ITF match series — focus lane before ATP/WTA/Challenger. */
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

export const ITF_SERIES_TICKERS = [
  "KXITFMATCH",
  "KXITFWMATCH",
  "KXITFDOUBLES",
  "KXITFWDOUBLES",
] as const;

export type ItfSeriesTicker = (typeof ITF_SERIES_TICKERS)[number];

export function isItfSeriesTicker(value: string): value is ItfSeriesTicker {
  return (ITF_SERIES_TICKERS as readonly string[]).includes(value);
}

export function isItfKalshiTicker(ticker: string): boolean {
  return isKalshiTickerInSeries(ticker, ITF_SERIES_TICKERS);
}

export function parseItfSeriesPrefix(ticker: string): string | null {
  return parseSeriesPrefix(ticker, ITF_SERIES_TICKERS);
}

/** YES side code suffix (e.g. DONMAR, SAN). */
export function parseItfYesSideCode(ticker: string): string | null {
  return parseYesSideCode(ticker, ITF_SERIES_TICKERS);
}

/** Matchup blob between date prefix and side suffix (e.g. DONMARDELHOY, SANALV). */
export function parseItfMatchupBlob(ticker: string): string | null {
  return parseMatchupBlob(ticker, ITF_SERIES_TICKERS);
}

export function parseItfEventTicker(ticker: string): string | null {
  return parseEventTicker(ticker, ITF_SERIES_TICKERS);
}

/** Ambiguous prefix∩suffix partitions hard-fail (null) — never best-guess. */
export function splitItfMatchupBlob(blob: string, yesSideCode: string): [string, string] | null {
  return splitMatchupBlob(blob, yesSideCode);
}

export function itfMatchupBlobIsUnambiguous(blob: string, codeA: string, codeB: string): boolean {
  return matchupBlobIsUnambiguous(blob, codeA, codeB);
}

/** Hard-fail (null) when the matchup blob cannot be uniquely partitioned. */
export function itfSideCodesForEvent(eventTicker: string, marketTickers: string[]): [string, string] | null {
  return sideCodesForEvent(ITF_SERIES_TICKERS, eventTicker, marketTickers);
}

export function itfTourFromSeries(series: string): string {
  switch (series) {
    case "KXITFMATCH":
      return "ITF-M";
    case "KXITFWMATCH":
      return "ITF-W";
    case "KXITFDOUBLES":
      return "ITF-MD";
    case "KXITFWDOUBLES":
      return "ITF-WD";
    default:
      return "ITF";
  }
}

export function itfFormatLabel(series: string): "itf-singles" | "itf-doubles" {
  return series.includes("DOUBLE") ? "itf-doubles" : "itf-singles";
}
