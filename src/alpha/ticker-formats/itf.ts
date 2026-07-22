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

/** Split compressed blob given the YES side code on this market. */
export function splitItfMatchupBlob(blob: string, yesSideCode: string): [string, string] | null {
  if (!blob || !yesSideCode) return null;
  if (blob.startsWith(yesSideCode)) {
    const other = blob.slice(yesSideCode.length);
    return other ? [yesSideCode, other] : null;
  }
  if (blob.endsWith(yesSideCode)) {
    const other = blob.slice(0, blob.length - yesSideCode.length);
    return other ? [other, yesSideCode] : null;
  }
  return null;
}

export function itfSideCodesForEvent(eventTicker: string, marketTickers: string[]): [string, string] | null {
  const codes = marketTickers
    .map((t) => parseItfYesSideCode(t))
    .filter((c): c is string => Boolean(c));
  const unique = [...new Set(codes)];
  if (unique.length !== 2) return null;
  const blob = parseItfMatchupBlob(marketTickers[0] ?? "");
  if (!blob) return null;
  const [a, b] = unique.sort((x, y) => x.localeCompare(y));
  const splitA = splitItfMatchupBlob(blob, a);
  const splitB = splitItfMatchupBlob(blob, b);
  if (splitA && splitA[0] === a && splitA[1] === b) return [a, b];
  if (splitB && splitB[0] === b && splitB[1] === a) return [a, b];
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
