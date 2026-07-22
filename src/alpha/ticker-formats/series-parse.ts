/**
 * Shared Kalshi match-series ticker parsing — parameterized by series list.
 * Shape: <SERIES>-<YYMONDD><MATCHUP-BLOB>-<YES-SIDE-CODE>
 * (e.g. KXITFMATCH-26JUL22SANALV-SAN, KXATPMATCH-26JUL22BORBUR-BUR).
 * Ambiguous matchup-blob partitions hard-fail (null) — never best-guess.
 */

export function parseSeriesPrefix(ticker: string, seriesTickers: readonly string[]): string | null {
  for (const series of seriesTickers) {
    if (ticker.startsWith(`${series}-`)) return series;
  }
  return null;
}

export function isKalshiTickerInSeries(ticker: string, seriesTickers: readonly string[]): boolean {
  return parseSeriesPrefix(ticker, seriesTickers) != null;
}

/** YES side code suffix (e.g. BUR, SAN). */
export function parseYesSideCode(ticker: string, seriesTickers: readonly string[]): string | null {
  const series = parseSeriesPrefix(ticker, seriesTickers);
  if (!series) return null;
  const rest = ticker.slice(series.length + 1);
  const dash = rest.lastIndexOf("-");
  if (dash <= 0) return null;
  return rest.slice(dash + 1) || null;
}

/** Matchup blob between date prefix and side suffix (e.g. BORBUR, SANALV). */
export function parseMatchupBlob(ticker: string, seriesTickers: readonly string[]): string | null {
  const series = parseSeriesPrefix(ticker, seriesTickers);
  if (!series) return null;
  const rest = ticker.slice(series.length + 1);
  const m = rest.match(/^(\d{2}[A-Z]{3}\d{2})([A-Z]+)-[A-Z0-9]+$/);
  return m?.[2] ?? null;
}

export function parseEventTicker(ticker: string, seriesTickers: readonly string[]): string | null {
  const series = parseSeriesPrefix(ticker, seriesTickers);
  const side = parseYesSideCode(ticker, seriesTickers);
  const blob = parseMatchupBlob(ticker, seriesTickers);
  if (!series || !side || !blob) return null;
  const dateMatch = ticker.match(/\d{2}[A-Z]{3}\d{2}/);
  if (!dateMatch) return null;
  return `${series}-${dateMatch[0]}${blob}`;
}

/**
 * Split compressed blob given the YES side code on this market.
 * Ambiguous prefix∩suffix partitions hard-fail (null) — never best-guess.
 */
export function splitMatchupBlob(blob: string, yesSideCode: string): [string, string] | null {
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
export function matchupBlobIsUnambiguous(blob: string, codeA: string, codeB: string): boolean {
  if (!blob || !codeA || !codeB || codeA === codeB) return false;
  const forward = codeA + codeB === blob;
  const reverse = codeB + codeA === blob;
  if (forward === reverse) return false; // both or neither — ambiguous / invalid
  const splitA = splitMatchupBlob(blob, codeA);
  const splitB = splitMatchupBlob(blob, codeB);
  if (!splitA || !splitB) return false;
  const parts = new Set([splitA[0], splitA[1], splitB[0], splitB[1]]);
  return parts.size === 2 && parts.has(codeA) && parts.has(codeB);
}

/**
 * Side codes for an event — hard-fail (null) when the matchup blob cannot be
 * uniquely partitioned. Never return a best-guess mapping.
 */
export function sideCodesForEvent(
  seriesTickers: readonly string[],
  eventTicker: string,
  marketTickers: string[],
): [string, string] | null {
  const codes = marketTickers
    .map((t) => parseYesSideCode(t, seriesTickers))
    .filter((c): c is string => Boolean(c));
  const unique = [...new Set(codes)];
  if (unique.length !== 2) return null;
  const blob =
    parseMatchupBlob(marketTickers[0] ?? "", seriesTickers) ??
    (() => {
      const m = eventTicker.match(/\d{2}[A-Z]{3}\d{2}([A-Z]+)$/);
      return m?.[1] ?? null;
    })();
  if (!blob) return null;
  const [a, b] = unique.sort((x, y) => x.localeCompare(y));
  if (!matchupBlobIsUnambiguous(blob, a, b)) return null;
  return [a, b];
}
