/** Branded registry identities. Parse once at source/config boundaries. */

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type IntegrationId = Brand<string, "IntegrationId">;
export type SourceScopeId = Brand<string, "SourceScopeId">;
export type SourceTagId = Brand<string, "SourceTagId">;
export type AdapterId = Brand<string, "AdapterId">;
export type CompetitionKey = Brand<string, "CompetitionKey">;
export type SportKey = Brand<string, "SportKey">;
export type SourceKey = Brand<string, "SourceKey">;
export type SportFamilyKey = Brand<string, "SportFamilyKey">;
export type SelectorKind = Brand<string, "SelectorKind">;
export type MarketKind = Brand<string, "MarketKind">;
export type IdentityFieldKey = Brand<string, "IdentityFieldKey">;
export type SourceMarketType = Brand<string, "SourceMarketType">;
export type SourceEventId = Brand<string, "SourceEventId">;
export type SourceParticipantId = Brand<string, "SourceParticipantId">;
export type SourceMarketId = Brand<string, "SourceMarketId">;
export type SourceInventoryRunId = Brand<string, "SourceInventoryRunId">;
export type OutcomeKey = Brand<string, "OutcomeKey">;
export type SourceCacheKey = Brand<string, "SourceCacheKey">;

function required(raw: string, label: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`${label} required`);
  return value;
}

function canonicalKey(raw: string, label: string): string {
  const value = required(raw, label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!value) throw new Error(`${label} required after normalization`);
  return value;
}

export const asIntegrationId = (raw: string): IntegrationId =>
  required(raw, "IntegrationId") as IntegrationId;
export const asSourceScopeId = (raw: string): SourceScopeId =>
  required(raw, "SourceScopeId") as SourceScopeId;
export const asSourceTagId = (raw: string): SourceTagId =>
  required(raw, "SourceTagId") as SourceTagId;
export const asAdapterId = (raw: string): AdapterId => required(raw, "AdapterId") as AdapterId;
export const asCompetitionKey = (raw: string): CompetitionKey =>
  canonicalKey(raw, "CompetitionKey") as CompetitionKey;
export const asSportKey = (raw: string): SportKey => canonicalKey(raw, "SportKey") as SportKey;
export const asSourceKey = (raw: string): SourceKey => canonicalKey(raw, "SourceKey") as SourceKey;
export const asSportFamilyKey = (raw: string): SportFamilyKey =>
  canonicalKey(raw, "SportFamilyKey") as SportFamilyKey;
export const asSelectorKind = (raw: string): SelectorKind =>
  canonicalKey(raw, "SelectorKind") as SelectorKind;
export const asMarketKind = (raw: string): MarketKind =>
  canonicalKey(raw, "MarketKind") as MarketKind;
export const asIdentityFieldKey = (raw: string): IdentityFieldKey =>
  canonicalKey(raw, "IdentityFieldKey") as IdentityFieldKey;
export const asSourceMarketType = (raw: string): SourceMarketType =>
  canonicalKey(raw, "SourceMarketType") as SourceMarketType;
export const asSourceEventId = (raw: string): SourceEventId =>
  required(raw, "SourceEventId") as SourceEventId;
export const asSourceParticipantId = (raw: string): SourceParticipantId =>
  required(raw, "SourceParticipantId") as SourceParticipantId;
export const asSourceMarketId = (raw: string): SourceMarketId =>
  required(raw, "SourceMarketId") as SourceMarketId;
export const asSourceInventoryRunId = (raw: string): SourceInventoryRunId =>
  required(raw, "SourceInventoryRunId") as SourceInventoryRunId;
export const asOutcomeKey = (raw: string): OutcomeKey =>
  required(raw, "OutcomeKey") as OutcomeKey;
export const asSourceCacheKey = (raw: string): SourceCacheKey =>
  required(raw, "SourceCacheKey") as SourceCacheKey;

export const SPORT = {
  tennis: asSportKey("tennis"),
  tableTennis: asSportKey("table_tennis"),
} as const;

export const SOURCE = {
  kalshi: asSourceKey("kalshi"),
  polymarket: asSourceKey("polymarket"),
} as const;

export const SELECTOR = {
  kalshiSeries: asSelectorKind("kalshi_series"),
  polymarketTag: asSelectorKind("polymarket_tag"),
  polymarketSportsMetadata: asSelectorKind("polymarket_sports_metadata"),
  kalshiSeriesMetadata: asSelectorKind("kalshi_series_metadata"),
} as const;

export const MARKET = {
  matchWinner: asMarketKind("match_winner"),
  tournamentWinner: asMarketKind("tournament_winner"),
  setWinner: asMarketKind("set_winner"),
  s1Game: asMarketKind("s1_game"),
  s2Game: asMarketKind("s2_game"),
  s3Game: asMarketKind("s3_game"),
  s4Game: asMarketKind("s4_game"),
  s5Game: asMarketKind("s5_game"),
  gameWinner: asMarketKind("game_winner"),
  gameSpread: asMarketKind("game_spread"),
  gameTotal: asMarketKind("game_total"),
  exactScore: asMarketKind("exact_score"),
  exactSets: asMarketKind("exact_sets"),
  totalSets: asMarketKind("total_sets"),
  tiebreak: asMarketKind("tiebreak"),
  other: asMarketKind("other"),
} as const;

export const IDENTITY = {
  tennisCompetitor: asIdentityFieldKey("tennis_competitor"),
  tennisDoublesCompetitor: asIdentityFieldKey("tennis_doubles_competitor"),
  tableTennisCompetitor: asIdentityFieldKey("table_tennis_competitor"),
  literalOutcome: asIdentityFieldKey("literal_outcome"),
  none: asIdentityFieldKey("none"),
} as const;

export function parseSportKey(raw: unknown): SportKey {
  if (typeof raw !== "string") throw new Error("SportKey: expected string");
  const key = canonicalKey(raw, "SportKey");
  if (key === "ping_pong" || key === "pingpong" || key === "tabletennis") {
    return SPORT.tableTennis;
  }
  return asSportKey(key);
}

export function parseSourceKey(raw: unknown): SourceKey {
  if (typeof raw !== "string") throw new Error("SourceKey: expected string");
  return asSourceKey(raw);
}

export function unbrand<T extends string>(raw: T): string {
  return raw;
}
