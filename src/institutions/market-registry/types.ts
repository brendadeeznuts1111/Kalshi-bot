import type {
  AdapterId,
  CompetitionKey,
  IdentityFieldKey,
  IntegrationId,
  MarketKind,
  OutcomeKey,
  SelectorKind,
  SourceEventId,
  SourceInventoryRunId,
  SourceKey,
  SourceMarketId,
  SourceParticipantId,
  SourceMarketType,
  SourceScopeId,
  SportFamilyKey,
  SportKey,
} from "./brands.ts";

export type IntegrationState = "enabled" | "disabled" | "unsupported" | "discovering";
export type RegistrationMode = "inventory" | "match" | "trade";
export type EventType = "match" | "tournament";
export type ParticipantFormat = "singles" | "doubles" | "team" | "mixed" | "field";
export type SourceCapability = "inventory" | "quotes" | "reconciliation" | "trade";
export type SemanticConfidence = "exact" | "discovery";

export type SportDefinition = {
  key: SportKey;
  label: string;
  family: SportFamilyKey;
  aliases: readonly string[];
};

export type SourceDefinition = {
  key: SourceKey;
  label: string;
};

/** Generic selector envelope. Each source adapter owns and parses its parameter shape. */
export type SourceSelector = {
  kind: SelectorKind;
  scope: SourceScopeId;
  sport?: SportKey;
  parameters: Readonly<Record<string, string>>;
};

export type AdapterDefinition = {
  id: AdapterId;
  source: SourceKey;
  idNamespace: "source_global" | "selector_scoped";
  parserVersion: number;
  selectorKinds: readonly SelectorKind[];
  metadataSelectorKinds: readonly SelectorKind[];
  metadataDiscovery?: SourceSelector;
  validateSelector: (selector: SourceSelector) => readonly string[];
  cachePolicy: {
    freshForMs: number;
    staleForMs: number;
    failureThreshold: number;
  };
};

export type SourceMarketMapping = {
  sourceMarketType: SourceMarketType;
  marketKind: MarketKind;
};

export type CompetitionBinding = {
  competition: CompetitionKey;
  selector: SourceSelector;
  semanticConfidence: SemanticConfidence;
  eventTypes: readonly EventType[];
  participantFormats: readonly ParticipantFormat[];
  marketKinds: readonly MarketKind[];
  identityFields: readonly IdentityFieldKey[];
  sourceMarketMappings: readonly SourceMarketMapping[];
  unmappedMarketPolicy: "quarantine" | "reject";
  declaredUse: RegistrationMode;
};

export type SportSourceRegistration = {
  integration: IntegrationId;
  sport: SportKey;
  source: SourceKey;
  state: IntegrationState;
  adapter: AdapterId;
  declaredCapabilities: readonly SourceCapability[];
  operationalCapabilities: readonly SourceCapability[];
  competitions: readonly CompetitionBinding[];
  reason?: string;
};

export type SportsSourceRegistry = {
  sports: readonly SportDefinition[];
  sources: readonly SourceDefinition[];
  adapters: readonly AdapterDefinition[];
  integrations: readonly SportSourceRegistration[];
};

export type SourceFetchRequest<Cursor extends string = string> = {
  selector: SourceSelector;
  inventoryRunId?: SourceInventoryRunId;
  pageIndex?: number;
  cursor?: Cursor;
  limit: number;
};

export type SourcePage<Row extends object, Cursor extends string = string> = {
  request: SourceFetchRequest<Cursor>;
  observedAtMs: number;
  records: readonly Row[];
  nextCursor?: Cursor;
  exhausted: boolean;
};

export type SourceProvenance = {
  adapter: AdapterId;
  selector: SourceSelector;
  observedAtMs: number;
  sourceUpdatedAtMs?: number;
  inventoryRunId?: SourceInventoryRunId;
};

type SourceOutcomeIdentity = { outcome: OutcomeKey };

export type CompleteSourceOutcomeQuote = SourceOutcomeIdentity & {
  ordinal: number;
  label: string;
  participantId: SourceParticipantId | null;
  probability: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  lastTradeAtMs: number | null;
};

export type PartialSourceOutcomeQuote = SourceOutcomeIdentity & {
  ordinal?: number;
  label?: string;
  participantId?: SourceParticipantId | null;
  probability?: number | null;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  lastTradeAtMs?: number | null;
};

export type NormalizedOutcomeQuote = CompleteSourceOutcomeQuote | PartialSourceOutcomeQuote;

type SourceMarketIdentity = { id: SourceMarketId };

export type CompleteSourceMarket = SourceMarketIdentity & {
  sourceMarketType: SourceMarketType | null;
  marketKind: MarketKind | null;
  title: string;
  status: string | null;
  closesAtMs: number | null;
  result: string | null;
  sourceUpdatedAtMs?: number;
  subjectParticipantId: SourceParticipantId | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  clobLiquidity: number | null;
  openInterest: number | null;
  outcomes: readonly CompleteSourceOutcomeQuote[];
};

export type PartialSourceMarket = SourceMarketIdentity & {
  sourceMarketType?: SourceMarketType | null;
  marketKind?: MarketKind | null;
  title?: string;
  status?: string | null;
  closesAtMs?: number | null;
  result?: string | null;
  sourceUpdatedAtMs?: number;
  subjectParticipantId?: SourceParticipantId | null;
  volume?: number | null;
  volume24h?: number | null;
  liquidity?: number | null;
  clobLiquidity?: number | null;
  openInterest?: number | null;
  outcomes?: readonly PartialSourceOutcomeQuote[];
};

export type NormalizedSourceMarket = CompleteSourceMarket | PartialSourceMarket;

export type NormalizedSourceParticipant = {
  id: SourceParticipantId;
  ordinal: number;
  label: string;
};

type SourceObservationIdentity = {
  source: SourceKey;
  sport: SportKey;
  eventId: SourceEventId;
  provenance: SourceProvenance;
};

export type CompleteSourceObservation = SourceObservationIdentity & {
  snapshotCompleteness: "complete";
  title: string;
  status: string | null;
  closesAtMs: number | null;
  result: string | null;
  startsAtMs: number | null;
  eventType: EventType | null;
  participantFormat: ParticipantFormat | null;
  participants: readonly NormalizedSourceParticipant[];
  markets: readonly CompleteSourceMarket[];
};

export type PartialSourceObservation = SourceObservationIdentity & {
  snapshotCompleteness: "partial";
  title?: string;
  status?: string | null;
  closesAtMs?: number | null;
  result?: string | null;
  startsAtMs?: number | null;
  eventType?: EventType | null;
  participantFormat?: ParticipantFormat | null;
  participants?: readonly NormalizedSourceParticipant[];
  markets?: readonly PartialSourceMarket[];
};

export type NormalizedSourceObservation = CompleteSourceObservation | PartialSourceObservation;

export type AdapterHealth = {
  state: "healthy" | "stale" | "degraded" | "circuit_open";
  consecutiveFailures: number;
  lastSuccessAtMs?: number;
  staleSinceMs?: number;
};

/** Runtime venue template. `parsePage` is the parse-once wire boundary. */
export interface SourceAdapter<
  Row extends object,
  Observation extends NormalizedSourceObservation,
  Cursor extends string = string,
> {
  readonly definition: AdapterDefinition;
  fetchPage(request: SourceFetchRequest<Cursor>): Promise<unknown>;
  parsePage(wire: unknown, request: SourceFetchRequest<Cursor>): SourcePage<Row, Cursor>;
  project(page: SourcePage<Row, Cursor>, binding: CompetitionBinding): readonly Observation[];
  health(): AdapterHealth;
}

export type SportsSourceRegistryArtifact = {
  schema: "sports-source-registry/v1";
  generatedAt: string;
  sports: ReadonlyArray<{ key: string; label: string; family: string; aliases: readonly string[] }>;
  sources: ReadonlyArray<{ key: string; label: string }>;
  adapters: ReadonlyArray<{
    id: string;
    source: string;
    idNamespace: "source_global" | "selector_scoped";
    parserVersion: number;
    selectorKinds: readonly string[];
    metadataSelectorKinds: readonly string[];
    cachePolicy: { freshForMs: number; staleForMs: number; failureThreshold: number };
    metadataDiscovery?: {
      kind: string;
      scope: string;
      sport?: string;
      parameters: Readonly<Record<string, string>>;
    };
  }>;
  integrations: ReadonlyArray<{
    integration: string;
    sport: string;
    source: string;
    state: IntegrationState;
    adapter: string;
    declaredCapabilities: readonly SourceCapability[];
    operationalCapabilities: readonly SourceCapability[];
    reason?: string;
    competitions: ReadonlyArray<{
      competition: string;
      semanticConfidence: SemanticConfidence;
      eventTypes: readonly EventType[];
      participantFormats: readonly ParticipantFormat[];
      marketKinds: readonly string[];
      identityFields: readonly string[];
      sourceMarketMappings: ReadonlyArray<{ sourceMarketType: string; marketKind: string }>;
      unmappedMarketPolicy: "quarantine" | "reject";
      declaredUse: RegistrationMode;
      selector: {
        kind: string;
        scope: string;
        sport?: string;
        parameters: Readonly<Record<string, string>>;
      };
    }>;
  }>;
};
