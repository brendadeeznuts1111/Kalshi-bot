/**
 * odds-registry — Bun.XML-driven bookmaker odds capacity (>=34 floor, N-generic).
 */
export { loadOddsRegistryConfig, parseOddsRegistryXml } from "./load.ts";
export { validateOddsRegistry } from "./validate.ts";
export { americanToDecimal, parseOddsXmlEvents } from "./xml-feed.ts";
export { oddsRegistryHealth, statusCardPng, statusCardSvg } from "./display.ts";
export type { StatusTone } from "./display.ts";
export { compareOddsVsVenues, VENUE_SPORT_MAP, venueSports } from "./venues.ts";
export { classifyConvergence, consensusSnapshot, detectValuePatterns, kalshiCentsToImplied } from "./value-patterns.ts";
export { buildOddsReportHtml, buildOddsReportMarkdown, escapeMarkdownCell, oddsReportConsensus } from "./report.ts";
export type { OddsReportConsensusRow, OddsReportInput } from "./report.ts";
export type { ConvergencePattern, ConvergenceSnapshot, DetectConvergenceOptions } from "./value-patterns.ts";
export {
  activeV3BookmakerNames,
  fetchV3Bookmakers,
  fetchV3Odds,
  ODDS_API_V3_BASE,
  parseV3OddsWire,
  V3_SLUG_TO_SPORT,
  V3_SPORT_MAP,
  v3NamesForSport,
} from "./odds-api-v3.ts";
export type { OddsApiV3Bookmaker } from "./odds-api-v3.ts";
export { connectAllBookmakers, connectBookmaker } from "./feed-client.ts";
export type { ConnectOptions, FeedClientResult } from "./feed-client.ts";
export type { DetectValuePatternsOptions, ValuePattern, VenuePriceRef } from "./value-patterns.ts";
export type { OddsVsVenuesPayload, SportConsensusRow, VenueCoverage } from "./venues.ts";
export type { OddsRegistryBookmaker, OddsRegistryConfig, OddsFeedType } from "./types.ts";
