/**
 * Sports alpha engine — product code in `src/alpha/`.
 * Harness supplies lift for odds-feed only (`odds-feed` dimension + `feeAware` detector).
 * Ticker mapping, shadow log, and calibration are built here; not GitHub research dimensions.
 */
export {
  americanToImplied,
  impliedProbabilities,
  impliedSideProbabilities,
  stripOverround,
} from "./vig-strip.ts";
export type { AmericanSideOdds } from "./vig-strip.ts";

export {
  fetchOdds,
  getModelProb,
  getModelProbByEventId,
  listPinnacleSnapshots,
  pinnacleSnapshot,
  resetOddsFeedCache,
} from "./odds-feed.ts";
export type { OddsFeedOptions } from "./odds-feed.ts";

export {
  PINNACLE_BOOKMAKER_KEY,
  asFeedEventId,
  tryFeedEventId,
  parseOddsEventsWire,
} from "./odds-types.ts";
export type {
  FeedEventId,
  FetchOddsResult,
  MarketSide,
  OddsEvent,
  PinnacleSnapshot,
} from "./odds-types.ts";

export {
  extractKalshiDateToken,
  extractTeamHints,
  loadTickerOverrides,
  mapTickerOrThrow,
  matchTicker,
  parseKalshiDateToken,
  parseNbaGameTeamCodes,
  resetTickerMapperCache,
  validateTickerMapping,
  TickerMappingError,
} from "./ticker-mapper.ts";
export type { FeedEventRef, MappedEvent, TickerMapperOptions } from "./ticker-mapper.ts";

export { buildPinnacleSignalContext, eventsToFeedRefs } from "./signal-context.ts";
export type { BuildPinnacleSignalInput } from "./signal-context.ts";

export { computeEdgeBreakdown, kalshiFee } from "./edge.ts";
export type { EdgeBreakdown } from "./edge.ts";

export { ODDS_CACHE_DB, SHADOW_LOG_PATH, TICKER_MAP_DB, TICKER_OVERRIDES_PATH } from "./paths.ts";
