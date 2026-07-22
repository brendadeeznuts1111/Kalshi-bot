/** Kalshi ITF match series — focus lane before ATP/WTA/Challenger. */

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
  const series = parseItfSeriesPrefix(ticker);
  return series != null && isItfSeriesTicker(series);
}

export function parseItfSeriesPrefix(ticker: string): string | null {
  for (const series of ITF_SERIES_TICKERS) {
    if (ticker.startsWith(`${series}-`)) return series;
  }
  return null;
}

/** YES side code suffix (e.g. DONMAR, SAN). */
export function parseItfYesSideCode(ticker: string): string | null {
  const series = parseItfSeriesPrefix(ticker);
  if (!series) return null;
  const rest = ticker.slice(series.length + 1);
  const dash = rest.lastIndexOf("-");
  if (dash <= 0) return null;
  return rest.slice(dash + 1) || null;
}

/** Matchup blob between date prefix and side suffix (e.g. DONMARDELHOY, SANALV). */
export function parseItfMatchupBlob(ticker: string): string | null {
  const series = parseItfSeriesPrefix(ticker);
  if (!series) return null;
  const rest = ticker.slice(series.length + 1);
  const m = rest.match(/^(\d{2}[A-Z]{3}\d{2})([A-Z]+)-[A-Z0-9]+$/);
  return m?.[2] ?? null;
}

export function parseItfEventTicker(ticker: string): string | null {
  const series = parseItfSeriesPrefix(ticker);
  const side = parseItfYesSideCode(ticker);
  const blob = parseItfMatchupBlob(ticker);
  if (!series || !side || !blob) return null;
  const dateMatch = ticker.match(/\d{2}[A-Z]{3}\d{2}/);
  if (!dateMatch) return null;
  return `${series}-${dateMatch[0]}${blob}`;
}

/**
 * Split compressed blob given the YES side code on this market.
 * Ambiguous prefix∩suffix partitions hard-fail (null) — never best-guess.
 */
export function splitItfMatchupBlob(blob: string, yesSideCode: string): [string, string] | null {
  if (!blob || !yesSideCode) return null;
  const asPrefix = blob.startsWith(yesSideCode) ? blob.slice(yesSideCode.length) : null;
  const asSuffix = blob.endsWith(yesSideCode) ? blob.slice(0, blob.length - yesSideCode.length) : null;
  if (asPrefix && asSuffix) {
    const prefixPair: [string, string] = [yesSideCode, asPrefix];
    const suffixPair: [string, string] = [asSuffix, yesSideCode];
    if (prefixPair[0] !== suffixPair[0] || prefixPair[1] !== suffixPair[1]) {
      return null;
    }
    return asPrefix ? prefixPair : null;
  }
  if (asPrefix) return asPrefix ? [yesSideCode, asPrefix] : null;
  if (asSuffix) return asSuffix ? [asSuffix, yesSideCode] : null;
  return null;
}

/** True when blob = codeA + codeB in either order with no leftover. */
export function itfMatchupBlobIsUnambiguous(blob: string, codeA: string, codeB: string): boolean {
  if (!blob || !codeA || !codeB || codeA === codeB) return false;
  const forward = codeA + codeB === blob;
  const reverse = codeB + codeA === blob;
  if (forward === reverse) return false; // both or neither — ambiguous / invalid
  const splitA = splitItfMatchupBlob(blob, codeA);
  const splitB = splitItfMatchupBlob(blob, codeB);
  if (!splitA || !splitB) return false;
  const parts = new Set([splitA[0], splitA[1], splitB[0], splitB[1]]);
  return parts.size === 2 && parts.has(codeA) && parts.has(codeB);
}

/**
 * Side codes for an event — hard-fail (null) when the matchup blob cannot be
 * uniquely partitioned. Never return a best-guess mapping.
 */
export function itfSideCodesForEvent(eventTicker: string, marketTickers: string[]): [string, string] | null {
  const codes = marketTickers
    .map((t) => parseItfYesSideCode(t))
    .filter((c): c is string => Boolean(c));
  const unique = [...new Set(codes)];
  if (unique.length !== 2) return null;
  const blob =
    parseItfMatchupBlob(marketTickers[0] ?? "") ??
    (() => {
      const m = eventTicker.match(/\d{2}[A-Z]{3}\d{2}([A-Z]+)$/);
      return m?.[1] ?? null;
    })();
  if (!blob) return null;
  const [a, b] = unique.sort((x, y) => x.localeCompare(y));
  if (!itfMatchupBlobIsUnambiguous(blob, a, b)) return null;
  return [a, b];
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
