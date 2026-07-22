import {
  isItfKalshiTicker,
  itfSideCodesForEvent,
  parseItfMatchupBlob,
  parseItfYesSideCode,
  splitItfMatchupBlob,
} from "./itf.ts";
import {
  isTourKalshiTicker,
  parseTourMatchupBlob,
  parseTourYesSideCode,
  splitTourMatchupBlob,
} from "./tour.ts";
import {
  isMlbGameTicker,
  mlbTeamNameMatchesCode,
  mlbYesIsHomeTeam,
  mlbYesTeamCodes,
  parseMlbMatchupBlob,
  parseMlbYesTeamCode,
  splitMlbMatchupBlob,
} from "./mlb.ts";
import {
  isNbaGameTicker,
  nbaTeamNameMatchesCode,
  nbaYesIsHomeTeam,
  nbaYesTeamCodes,
  parseNbaGameTeamCodes,
} from "./nba.ts";

export type TickerSportFormat = "nba" | "mlb" | "itf" | "tour" | "unknown";

export { NBA_TEAM_CODES, parseNbaGameTeamCodes } from "./nba.ts";
export {
  MLB_TEAM_CODES,
  mlbYesIsHomeTeam,
  mlbYesTeamCodes,
  parseMlbMatchupBlob,
  parseMlbYesTeamCode,
  splitMlbMatchupBlob,
} from "./mlb.ts";
export {
  ITF_SERIES_TICKERS,
  isItfKalshiTicker,
  isItfSeriesTicker,
  itfSideCodesForEvent,
  parseItfEventTicker,
  parseItfMatchupBlob,
  parseItfSeriesPrefix,
  parseItfYesSideCode,
  splitItfMatchupBlob,
  itfMatchupBlobIsUnambiguous,
} from "./itf.ts";
export {
  TOUR_SERIES_TICKERS,
  isTourKalshiTicker,
  isTourSeriesTicker,
  tourSideCodesForEvent,
  parseTourEventTicker,
  parseTourMatchupBlob,
  parseTourSeriesPrefix,
  parseTourYesSideCode,
  splitTourMatchupBlob,
  tourMatchupBlobIsUnambiguous,
  tourFromSeries,
  tourFormatLabel,
} from "./tour.ts";

export function detectTickerFormat(ticker: string): TickerSportFormat {
  if (isNbaGameTicker(ticker)) return "nba";
  if (isMlbGameTicker(ticker)) return "mlb";
  if (isItfKalshiTicker(ticker)) return "itf";
  if (isTourKalshiTicker(ticker)) return "tour";
  return "unknown";
}

export function parseGameTeamCodes(ticker: string): [string, string] | null {
  const format = detectTickerFormat(ticker);
  if (format === "nba") return parseNbaGameTeamCodes(ticker);
  if (format === "mlb") return mlbYesTeamCodes(ticker);
  if (format === "itf") {
    const yes = parseItfYesSideCode(ticker);
    const blob = parseItfMatchupBlob(ticker);
    if (!yes || !blob) return null;
    return splitItfMatchupBlob(blob, yes);
  }
  if (format === "tour") {
    const yes = parseTourYesSideCode(ticker);
    const blob = parseTourMatchupBlob(ticker);
    if (!yes || !blob) return null;
    return splitTourMatchupBlob(blob, yes);
  }
  return null;
}

export function teamNameMatchesCode(ticker: string, code: string, teamName: string): boolean {
  const format = detectTickerFormat(ticker);
  if (format === "nba") return nbaTeamNameMatchesCode(code, teamName);
  if (format === "mlb") return mlbTeamNameMatchesCode(code, teamName);
  if (format === "itf" || format === "tour") return teamName.toUpperCase().includes(code);
  return teamName.toUpperCase().includes(code);
}

export function bothTeamsMatchedForTicker(
  ticker: string,
  homeTeam: string,
  awayTeam: string,
): boolean {
  const pair = parseGameTeamCodes(ticker);
  if (pair) {
    const [a, b] = pair;
    const homeHit =
      teamNameMatchesCode(ticker, a, homeTeam) || teamNameMatchesCode(ticker, b, homeTeam);
    const awayHit =
      teamNameMatchesCode(ticker, a, awayTeam) || teamNameMatchesCode(ticker, b, awayTeam);
    return homeHit && awayHit;
  }
  const hints = extractGenericTeamHints(ticker);
  const homeHint = hints.some((h) => homeTeam.toUpperCase().includes(h));
  const awayHint = hints.some((h) => awayTeam.toUpperCase().includes(h));
  return homeHint && awayHint;
}

export function extractGenericTeamHints(ticker: string): string[] {
  const upper = ticker.replace(/[^A-Z]/g, "");
  const hints: string[] = [];
  for (let len = 3; len <= 4; len++) {
    if (upper.length >= len) hints.push(upper.slice(-len));
  }
  return [...new Set(hints)];
}

export function extractTeamHints(ticker: string): string[] {
  const pair = parseGameTeamCodes(ticker);
  if (pair) return pair;
  return extractGenericTeamHints(ticker);
}

/** Pinnacle novig probability for the YES side of this Kalshi market. */
export function yesProbabilityFromSnapshot(
  ticker: string,
  homeProb: number,
  awayProb: number,
  homeTeam: string,
  awayTeam: string,
): number {
  const format = detectTickerFormat(ticker);
  if (format === "nba" && nbaYesIsHomeTeam(ticker)) return homeProb;
  if (format === "mlb") {
    return mlbYesIsHomeTeam(ticker, homeTeam, awayTeam) ? homeProb : awayProb;
  }
  if (format === "itf" || format === "tour") {
    const yesCode =
      format === "itf" ? parseItfYesSideCode(ticker) : parseTourYesSideCode(ticker);
    if (!yesCode) return homeProb;
    if (teamNameMatchesCode(ticker, yesCode, homeTeam)) return homeProb;
    if (teamNameMatchesCode(ticker, yesCode, awayTeam)) return awayProb;
    const pair = parseGameTeamCodes(ticker);
    if (pair) {
      const other = yesCode === pair[0] ? pair[1] : pair[0];
      if (teamNameMatchesCode(ticker, other, homeTeam)) return awayProb;
      if (teamNameMatchesCode(ticker, other, awayTeam)) return homeProb;
    }
    return homeProb;
  }
  return homeProb;
}
