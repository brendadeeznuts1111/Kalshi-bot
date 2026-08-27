/**
 * odds-registry types — the Bun.XML-driven bookmaker capacity contract.
 * Capacity floor: >= 34 bookmakers (validate.ts gate); the model is N-generic.
 */

export type OddsFeedType = "odds-api-v3" | "fonbet-ws" | "bun-xml";

export interface OddsRegistryBookmaker {
  /** Slug key, e.g. "bet365". */
  key: string;
  /** Display + API name (Odds API v3 uses names, e.g. "Bet365"). */
  name: string;
  feed: OddsFeedType;
  /** The Odds API v3 region for json feeds. */
  region?: string;
  /** Comma-separated market families (h2h, spreads, totals). */
  markets?: string;
  /** Override endpoint for xml/ws feeds. */
  endpoint?: string;
  /** Sports the bookmaker covers (sport keys, e.g. basketball_nba). */
  sports: string[];
}

export interface OddsRegistryConfig {
  version: string;
  capacityFloor: number;
  bookmakers: OddsRegistryBookmaker[];
}

