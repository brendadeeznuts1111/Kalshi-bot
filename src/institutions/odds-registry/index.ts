/**
 * odds-registry — Bun.XML-driven bookmaker odds capacity (>=34 floor, N-generic).
 */
export { loadOddsRegistryConfig, parseOddsRegistryXml } from "./load.ts";
export { validateOddsRegistry } from "./validate.ts";
export { americanToDecimal, parseOddsXmlEvents } from "./xml-feed.ts";
export type { OddsRegistryBookmaker, OddsRegistryConfig, OddsFeedType } from "./types.ts";
