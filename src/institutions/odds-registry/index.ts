/**
 * odds-registry — Bun.XML-driven bookmaker odds capacity (>=34 floor, N-generic).
 */
export { loadOddsRegistryConfig, parseOddsRegistryXml } from "./load.ts";
export { validateOddsRegistry } from "./validate.ts";
export { americanToDecimal, parseOddsXmlEvents } from "./xml-feed.ts";
export { oddsRegistryHealth, statusCardPng, statusCardSvg } from "./display.ts";
export type { StatusTone } from "./display.ts";
export { compareOddsVsVenues, VENUE_SPORT_MAP, venueSports } from "./venues.ts";
export { detectValuePatterns, kalshiCentsToImplied } from "./value-patterns.ts";
export type { DetectValuePatternsOptions, ValuePattern, VenuePriceRef } from "./value-patterns.ts";
export type { OddsVsVenuesPayload, SportConsensusRow, VenueCoverage } from "./venues.ts";
export type { OddsRegistryBookmaker, OddsRegistryConfig, OddsFeedType } from "./types.ts";
