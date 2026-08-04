import {
  asSeriesTicker,
  type SeriesTicker,
  unbrand as unbrandEventStore,
} from "../event-store/brands.ts";
import {
  marketKindFromSeries,
  TENNIS_LADDER_SERIES,
} from "../event-store/tennis-ladder.ts";
import {
  asCompetitionKey,
  asIdentityFieldKey,
  asIntegrationId,
  asMarketKind,
  asSelectorKind,
  asSourceMarketType,
  asSourceCacheKey,
  asSourceScopeId,
  asSourceTagId,
  ADAPTER,
  asSportFamilyKey,
  IDENTITY,
  MARKET,
  SELECTOR,
  SOURCE,
  SPORT,
  unbrand,
  type SourceKey,
  type SourceCacheKey,
  type SourceTagId,
  type SportKey,
} from "./brands.ts";
import { defineAdapter, defineIntegration, defineSource, defineSport } from "./define.ts";
import { assertSportsSourceRegistry } from "./validate.ts";
import type {
  CompetitionBinding,
  RegistrationMode,
  SourceSelector,
  SportsSourceRegistry,
  SportsSourceRegistryArtifact,
  SportSourceRegistration,
} from "./types.ts";

export const SPORTS = [
  defineSport({
    key: SPORT.tennis,
    label: "Tennis",
    family: asSportFamilyKey("racquet"),
    aliases: ["lawn tennis"],
  }),
  defineSport({
    key: SPORT.tableTennis,
    label: "Table tennis",
    family: asSportFamilyKey("racquet"),
    aliases: ["table-tennis", "ping pong", "ping-pong"],
  }),
] as const;

export const SOURCES = [
  defineSource({ key: SOURCE.kalshi, label: "Kalshi" }),
  defineSource({ key: SOURCE.polymarket, label: "Polymarket" }),
] as const;

function selector(
  kind: SourceSelector["kind"],
  scope: string,
  parameters: Readonly<Record<string, string>>,
  sport?: SportKey,
): SourceSelector {
  return { kind, scope: asSourceScopeId(scope), ...(sport ? { sport } : {}), parameters };
}

function validateKalshiSelector(row: SourceSelector): string[] {
  if (row.kind === SELECTOR.kalshiSeriesMetadata) {
    return row.parameters.endpoint === "/series" ? [] : ["series metadata endpoint must be /series"];
  }
  if (row.kind !== SELECTOR.kalshiSeries) return ["unsupported Kalshi selector kind"];
  const errors: string[] = [];
  const series = row.parameters.series;
  if (!series) errors.push("series required");
  if (row.parameters.endpoint !== "/events") errors.push("endpoint must be /events");
  if (row.parameters.status !== "open") errors.push("status must be open");
  if (row.parameters.withNestedMarkets !== "true") {
    errors.push("withNestedMarkets must be true");
  }
  if (row.parameters.category !== "Sports") errors.push("category must be Sports");
  if (!row.parameters.tag) errors.push("tag required");
  if (series && unbrand(row.scope) !== `kalshi:series:${series}`) {
    errors.push("series scope mismatch");
  }
  return errors;
}

function validatePolymarketSelector(row: SourceSelector): string[] {
  if (row.kind === SELECTOR.polymarketSportsMetadata) {
    return row.parameters.endpoint === "/sports" ? [] : ["sports metadata endpoint must be /sports"];
  }
  if (row.kind !== SELECTOR.polymarketTag) return ["unsupported Polymarket selector kind"];
  const tagId = row.parameters.tagId;
  const errors: string[] = [];
  if (!tagId) errors.push("tagId required");
  if (!row.parameters.tagSlug) errors.push("tagSlug required");
  if (tagId && unbrand(row.scope) !== `polymarket:tag:${tagId}`) {
    errors.push("tag scope mismatch");
  }
  return errors;
}

export const ADAPTERS = [
  defineAdapter({
    id: ADAPTER.kalshiEvents,
    source: SOURCE.kalshi,
    idNamespace: "source_global",
    parserVersion: 1,
    selectorKinds: [SELECTOR.kalshiSeries],
    metadataSelectorKinds: [SELECTOR.kalshiSeriesMetadata],
    metadataDiscovery: selector(SELECTOR.kalshiSeriesMetadata, "kalshi:metadata:series", {
      endpoint: "/series",
      relation: "category_tag",
    }),
    validateSelector: validateKalshiSelector,
    cachePolicy: { freshForMs: 60_000, staleForMs: 300_000, failureThreshold: 3 },
  }),
  defineAdapter({
    id: ADAPTER.polymarketGamma,
    source: SOURCE.polymarket,
    idNamespace: "source_global",
    parserVersion: 1,
    selectorKinds: [SELECTOR.polymarketTag],
    metadataSelectorKinds: [SELECTOR.polymarketSportsMetadata],
    metadataDiscovery: selector(
      SELECTOR.polymarketSportsMetadata,
      "polymarket:metadata:sports",
      { endpoint: "/sports", relation: "tag" },
    ),
    validateSelector: validatePolymarketSelector,
    cachePolicy: { freshForMs: 60_000, staleForMs: 300_000, failureThreshold: 3 },
  }),
] as const;

const KALSHI_TAG = {
  [SPORT.tennis]: "Tennis",
  [SPORT.tableTennis]: "Table Tennis",
} as const;

type KalshiBindingInput = {
  series: SeriesTicker;
  sport: SportKey;
  competition: string;
  eventTypes: CompetitionBinding["eventTypes"];
  participantFormats: CompetitionBinding["participantFormats"];
  marketKinds: CompetitionBinding["marketKinds"];
  identityFields: CompetitionBinding["identityFields"];
  mode: RegistrationMode;
};

function kalshiBinding(input: KalshiBindingInput): CompetitionBinding {
  const series = unbrandEventStore(input.series);
  const tag = KALSHI_TAG[input.sport as keyof typeof KALSHI_TAG];
  if (!tag) throw new Error(`Kalshi tag missing for sport: ${unbrand(input.sport)}`);
  return {
    competition: asCompetitionKey(input.competition),
    selector: selector(SELECTOR.kalshiSeries, `kalshi:series:${series}`, {
      series,
      category: "Sports",
      tag,
      sport: unbrand(input.sport),
      endpoint: "/events",
      status: "open",
      withNestedMarkets: "true",
    }, input.sport),
    semanticConfidence: "exact",
    eventTypes: input.eventTypes,
    participantFormats: input.participantFormats,
    marketKinds: input.marketKinds,
    identityFields: input.identityFields,
    sourceMarketMappings: [],
    unmappedMarketPolicy: "quarantine",
    declaredUse: input.mode,
  };
}

const TRADE_TENNIS_SERIES = new Set([
  "KXATPMATCH",
  "KXWTAMATCH",
  "KXATPCHALLENGERMATCH",
  "KXWTACHALLENGERMATCH",
  "KXITFMATCH",
  "KXITFWMATCH",
  "KXITFDOUBLES",
  "KXITFWDOUBLES",
]);

const VERIFIED_MATCH_TENNIS_SERIES = new Set([
  ...TRADE_TENNIS_SERIES,
  "KXATPDOUBLES",
  "KXWTADOUBLES",
]);

const EXTRA_TENNIS_SERIES = [
  "KXDAVISCUPMATCH",
  "KXUNITEDCUPMATCH",
  "KXSIXKINGSMATCH",
  "KXSIXKINGSSLAMMATCH",
  "KXBATTLEOFSEXES",
] as const;

const ALL_TENNIS_SERIES = [
  ...new Set([...Object.values(TENNIS_LADDER_SERIES).flat(), ...EXTRA_TENNIS_SERIES]),
];

function tennisCompetition(series: string): string {
  if (series.includes("DAVIS")) return "davis_cup";
  if (series.includes("UNITED")) return "united_cup";
  if (series.includes("SIXKINGS") || series.includes("BATTLE") || series.includes("EXHIBITION")) {
    return "exhibition";
  }
  if (series.includes("CHALLENGER")) return "challenger";
  if (series.includes("ITFW")) return "itf_women";
  if (series.includes("ITF")) return "itf_men";
  if (series.includes("WTA")) return "wta";
  return "atp";
}

function tennisParticipantFormat(series: string): CompetitionBinding["participantFormats"][number] {
  if (series.includes("DOUBLES")) return "doubles";
  if (series.includes("DAVIS") || series.includes("UNITED")) return "team";
  if (series.includes("BATTLE")) return "mixed";
  return "singles";
}

const VERIFIED_TENNIS_IDENTITY_SERIES = new Set([
  ...VERIFIED_MATCH_TENNIS_SERIES,
  "KXATPSETWINNER",
  "KXWTASETWINNER",
]);

function tennisIdentity(series: string) {
  if (!VERIFIED_TENNIS_IDENTITY_SERIES.has(series)) return IDENTITY.none;
  if (series === "KXATPDOUBLES" || series === "KXWTADOUBLES") {
    return IDENTITY.tennisDoublesCompetitor;
  }
  // Kalshi ITF doubles payloads use tennis_competitor, unlike ATP/WTA doubles.
  return IDENTITY.tennisCompetitor;
}

const KALSHI_TENNIS_BINDINGS = ALL_TENNIS_SERIES.map((rawSeries) => {
  const series = asSeriesTicker(rawSeries);
  const kind = asMarketKind(marketKindFromSeries(rawSeries));
  const mode: RegistrationMode = TRADE_TENNIS_SERIES.has(rawSeries)
    ? "trade"
    : kind === MARKET.matchWinner && VERIFIED_MATCH_TENNIS_SERIES.has(rawSeries)
      ? "match"
      : "inventory";
  return kalshiBinding({
    series,
    sport: SPORT.tennis,
    competition: tennisCompetition(rawSeries),
    eventTypes: ["match"],
    participantFormats: [tennisParticipantFormat(rawSeries)],
    marketKinds: [kind],
    identityFields: [tennisIdentity(rawSeries)],
    mode,
  });
});

const TABLE_TENNIS_SERIES = [
  ["KXITTFMENMATCH", "ittf", "match_winner", "singles"],
  ["KXITTFMEN", "ittf", "tournament_winner", "field"],
  ["KXWTABLETENNISMATCH", "wtt", "match_winner", "singles"],
  ["KXITTFWOMENMATCH", "ittf", "match_winner", "singles"],
  ["KXTTELITEGAME", "tt_elite", "match_winner", "singles"],
  ["KXTABLETENNIS", "table_tennis", "match_winner", "singles"],
  ["KXTABLETENNISMATCH", "table_tennis", "match_winner", "singles"],
  ["KXITTFWOMEN", "ittf", "tournament_winner", "field"],
] as const;

const KALSHI_TABLE_TENNIS_BINDINGS = TABLE_TENNIS_SERIES.map(
  ([rawSeries, competition, rawKind, participantFormat]) => {
    const observedMatchPayload = rawSeries === "KXTABLETENNISMATCH";
    const tournament = rawKind === "tournament_winner";
    return kalshiBinding({
      series: asSeriesTicker(rawSeries),
      sport: SPORT.tableTennis,
      competition,
      eventTypes: [tournament ? "tournament" : "match"],
      participantFormats: [participantFormat],
      marketKinds: [asMarketKind(rawKind)],
      identityFields: [
        observedMatchPayload ? IDENTITY.tableTennisCompetitor : IDENTITY.none,
      ],
      mode: observedMatchPayload ? "match" : "inventory",
    });
  },
);

function polymarketBinding(
  sport: SportKey,
  tagId: SourceTagId,
  tagSlug: string,
): CompetitionBinding {
  const observedMarketTypes =
    sport === SPORT.tableTennis
      ? ["moneyline", "table_tennis_match_totals", "table_tennis_game_handicap"]
      : [
          "moneyline",
          "tennis_first_set_totals",
          "tennis_match_totals",
          "tennis_set_games_totals",
          "tennis_set_handicap",
          "tennis_completed_match",
          "tennis_set_totals",
          "tennis_first_set_winner",
          "tennis_set_winner",
        ];
  const sourceMarketMappings = observedMarketTypes.map((sourceMarketType) => ({
    sourceMarketType: asSourceMarketType(sourceMarketType),
    marketKind:
      sourceMarketType === "moneyline"
        ? MARKET.matchWinner
        : sourceMarketType === "tennis_first_set_winner" ||
            sourceMarketType === "tennis_set_winner"
          ? MARKET.setWinner
          : MARKET.other,
  }));
  return {
    competition: asCompetitionKey(unbrand(sport)),
    selector: selector(SELECTOR.polymarketTag, `polymarket:tag:${unbrand(tagId)}`, {
      tagId: unbrand(tagId),
      tagSlug,
      sport: unbrand(sport),
    }, sport),
    semanticConfidence: "discovery",
    eventTypes: ["match", "tournament"],
    participantFormats: ["singles", "doubles", "team", "mixed", "field"],
    marketKinds:
      sport === SPORT.tennis
        ? [MARKET.matchWinner, MARKET.tournamentWinner, MARKET.setWinner, MARKET.other]
        : [MARKET.matchWinner, MARKET.tournamentWinner, MARKET.other],
    identityFields: [IDENTITY.literalOutcome],
    sourceMarketMappings,
    unmappedMarketPolicy: "quarantine",
    declaredUse: "match",
  };
}

export const INTEGRATIONS = [
  defineIntegration({
    integration: asIntegrationId("kalshi:tennis"),
    sport: SPORT.tennis,
    source: SOURCE.kalshi,
    state: "enabled",
    adapter: ADAPTER.kalshiEvents,
    declaredCapabilities: ["inventory", "quotes", "reconciliation", "trade"],
    operationalCapabilities: ["inventory", "quotes", "reconciliation", "trade"],
    competitions: KALSHI_TENNIS_BINDINGS,
  }),
  defineIntegration({
    integration: asIntegrationId("kalshi:table_tennis"),
    sport: SPORT.tableTennis,
    source: SOURCE.kalshi,
    state: "discovering",
    adapter: ADAPTER.kalshiEvents,
    declaredCapabilities: ["inventory", "quotes", "reconciliation"],
    operationalCapabilities: ["inventory"],
    competitions: KALSHI_TABLE_TENNIS_BINDINGS,
    reason: "Inventory is operational; quote, reconciliation, and persistence wiring is pending.",
  }),
  defineIntegration({
    integration: asIntegrationId("polymarket:tennis"),
    sport: SPORT.tennis,
    source: SOURCE.polymarket,
    state: "enabled",
    adapter: ADAPTER.polymarketGamma,
    declaredCapabilities: ["inventory", "quotes", "reconciliation"],
    operationalCapabilities: ["inventory", "quotes", "reconciliation"],
    competitions: [polymarketBinding(SPORT.tennis, asSourceTagId("864"), "tennis")],
  }),
  defineIntegration({
    integration: asIntegrationId("polymarket:table_tennis"),
    sport: SPORT.tableTennis,
    source: SOURCE.polymarket,
    state: "enabled",
    adapter: ADAPTER.polymarketGamma,
    declaredCapabilities: ["inventory", "quotes", "reconciliation"],
    operationalCapabilities: ["inventory", "quotes", "reconciliation"],
    competitions: [
      polymarketBinding(SPORT.tableTennis, asSourceTagId("103767"), "table-tennis"),
    ],
  }),
] as const satisfies readonly SportSourceRegistration[];

export const SPORTS_SOURCE_REGISTRY: SportsSourceRegistry = {
  sports: SPORTS,
  sources: SOURCES,
  adapters: ADAPTERS,
  integrations: INTEGRATIONS,
};

export function registrationFor(
  source: SourceKey,
  sport: SportKey,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SportSourceRegistration | undefined {
  return registry.integrations.find((row) => row.source === source && row.sport === sport);
}

function kalshiSeriesFromBinding(binding: CompetitionBinding): SeriesTicker | undefined {
  if (binding.selector.kind !== SELECTOR.kalshiSeries) return undefined;
  const raw = binding.selector.parameters.series;
  return raw ? asSeriesTicker(raw) : undefined;
}

export function kalshiBindingForSeries(
  series: SeriesTicker,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): CompetitionBinding | undefined {
  return registry.integrations
    .filter((row) => row.source === SOURCE.kalshi)
    .flatMap((row) => row.competitions)
    .find((binding) => kalshiSeriesFromBinding(binding) === series);
}

export function kalshiSportForSeries(
  series: SeriesTicker,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SportKey | undefined {
  return registry.integrations.find(
    (row) =>
      row.source === SOURCE.kalshi &&
      row.competitions.some((binding) => kalshiSeriesFromBinding(binding) === series),
  )?.sport;
}

export function kalshiIdentityFieldForSeries(
  series: SeriesTicker,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): CompetitionBinding["identityFields"][number] | undefined {
  return kalshiBindingForSeries(series, registry)?.identityFields[0];
}

export function kalshiSeriesForSport(
  sport: SportKey,
  modes: readonly RegistrationMode[] = ["inventory", "match", "trade"],
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SeriesTicker[] {
  const allowed = new Set(modes);
  return (registrationFor(SOURCE.kalshi, sport, registry)?.competitions ?? [])
    .filter((binding) => allowed.has(binding.declaredUse))
    .flatMap((binding) => {
      const series = kalshiSeriesFromBinding(binding);
      return series ? [series] : [];
    });
}

export const kalshiDeclaredReconciliationSeriesForSport = (sport: SportKey): SeriesTicker[] =>
  kalshiSeriesForSport(sport, ["match", "trade"]);

export function kalshiInventorySeriesForSport(
  sport: SportKey,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SeriesTicker[] {
  const registration = registrationFor(SOURCE.kalshi, sport, registry);
  if (
    !registration ||
    registration.state === "disabled" ||
    registration.state === "unsupported" ||
    !registration.operationalCapabilities.includes("inventory")
  ) {
    return [];
  }
  return kalshiSeriesForSport(sport, ["inventory", "match", "trade"], registry);
}

function operationalKalshiSeriesForSport(
  sport: SportKey,
  capability: "reconciliation" | "trade",
  modes: readonly RegistrationMode[],
): SeriesTicker[] {
  const registration = registrationFor(SOURCE.kalshi, sport);
  if (
    registration?.state !== "enabled" ||
    !registration.operationalCapabilities.includes(capability)
  ) {
    return [];
  }
  return kalshiSeriesForSport(sport, modes);
}

export const kalshiReconciliationSeriesForSport = (sport: SportKey): SeriesTicker[] =>
  operationalKalshiSeriesForSport(sport, "reconciliation", ["match", "trade"]);

export const kalshiTradeSeriesForSport = (sport: SportKey): SeriesTicker[] =>
  operationalKalshiSeriesForSport(sport, "trade", ["trade"]);

export type KalshiSeriesDrift = {
  registered: SeriesTicker[];
  quarantine: SeriesTicker[];
};

export function classifyKalshiSeriesDrift(
  sport: SportKey,
  observed: readonly SeriesTicker[],
): KalshiSeriesDrift {
  const known = new Set(kalshiSeriesForSport(sport).map(unbrandEventStore));
  return observed.reduce<KalshiSeriesDrift>(
    (result, series) => {
      (known.has(unbrandEventStore(series)) ? result.registered : result.quarantine).push(series);
      return result;
    },
    { registered: [], quarantine: [] },
  );
}

export type PolymarketTagSelector = {
  kind: typeof SELECTOR.polymarketTag;
  scope: SourceSelector["scope"];
  tagId: SourceTagId;
  tagSlug: string;
};

export function polymarketTagsForSport(
  sport: SportKey,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): PolymarketTagSelector[] {
  return (registrationFor(SOURCE.polymarket, sport, registry)?.competitions ?? []).flatMap(
    (binding) => {
      if (binding.selector.kind !== SELECTOR.polymarketTag) return [];
      const tagId = binding.selector.parameters.tagId;
      const tagSlug = binding.selector.parameters.tagSlug;
      if (!tagId || !tagSlug) return [];
      return [{ kind: SELECTOR.polymarketTag, scope: binding.selector.scope, tagId: asSourceTagId(tagId), tagSlug }];
    },
  );
}

export function sourceSelectorCacheKey(
  source: SourceKey,
  row: Pick<SourceSelector, "scope">,
): SourceCacheKey {
  return asSourceCacheKey(`${unbrand(source)}:${unbrand(row.scope)}`);
}

export function buildSportsSourceRegistryArtifact(
  generatedAt = new Date().toISOString(),
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SportsSourceRegistryArtifact {
  assertSportsSourceRegistry(registry);
  const serializeSelector = (row: SourceSelector) => ({
    kind: unbrand(row.kind),
    scope: unbrand(row.scope),
    ...(row.sport ? { sport: unbrand(row.sport) } : {}),
    parameters: row.parameters,
  });
  return {
    schema: "sports-source-registry/v1",
    generatedAt,
    sports: registry.sports.map((row) => ({
      key: unbrand(row.key),
      label: row.label,
      family: unbrand(row.family),
      aliases: row.aliases,
    })),
    sources: registry.sources.map((row) => ({ key: unbrand(row.key), label: row.label })),
    adapters: registry.adapters.map((adapter) => ({
      id: unbrand(adapter.id),
      source: unbrand(adapter.source),
      idNamespace: adapter.idNamespace,
      parserVersion: adapter.parserVersion,
      selectorKinds: adapter.selectorKinds.map(unbrand),
      metadataSelectorKinds: adapter.metadataSelectorKinds.map(unbrand),
      cachePolicy: adapter.cachePolicy,
      ...(adapter.metadataDiscovery
        ? { metadataDiscovery: serializeSelector(adapter.metadataDiscovery) }
        : {}),
    })),
    integrations: registry.integrations.map((integration) => ({
      integration: unbrand(integration.integration),
      sport: unbrand(integration.sport),
      source: unbrand(integration.source),
      state: integration.state,
      adapter: unbrand(integration.adapter),
      declaredCapabilities: integration.declaredCapabilities,
      operationalCapabilities: integration.operationalCapabilities,
      ...(integration.reason ? { reason: integration.reason } : {}),
      competitions: integration.competitions.map((binding) => ({
        competition: unbrand(binding.competition),
        semanticConfidence: binding.semanticConfidence,
        eventTypes: binding.eventTypes,
        participantFormats: binding.participantFormats,
        marketKinds: binding.marketKinds.map(unbrand),
        identityFields: binding.identityFields.map(unbrand),
        sourceMarketMappings: binding.sourceMarketMappings.map((mapping) => ({
          sourceMarketType: unbrand(mapping.sourceMarketType),
          marketKind: unbrand(mapping.marketKind),
        })),
        unmappedMarketPolicy: binding.unmappedMarketPolicy,
        declaredUse: binding.declaredUse,
        selector: serializeSelector(binding.selector),
      })),
    })),
  };
}
