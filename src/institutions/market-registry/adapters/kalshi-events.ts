import {
  competitorIdForMarket,
  fetchKalshiEventsPageWire,
  parseKalshiEventsPageWire,
  type FetchKalshiEventsPageOptions,
  type KalshiInventoryEvent,
  type KalshiMarketWire,
} from "../../../bot/kalshi-events-api.ts";
import { asSeriesTicker, unbrand as unbrandEventStore } from "../../event-store/brands.ts";
import {
  asOutcomeKey,
  asSourceEventId,
  asSourceMarketId,
  asSourceMarketType,
  asSourceParticipantId,
  ADAPTER,
  IDENTITY,
  SELECTOR,
  SOURCE,
  unbrand,
  type SourceParticipantId,
} from "../brands.ts";
import { ADAPTERS } from "../registry.ts";
import {
  inventorySourceAdapter,
  type AdapterDefinition,
  type CompetitionBinding,
  type InventorySourceAdapter,
  type NormalizedSourceParticipant,
  type PartialSourceMarket,
  type PartialSourceObservation,
  type SourceAdapter,
  type SourceFetchRequest,
  type SourcePage,
} from "../types.ts";
import { SourceAdapterHealthState } from "./health.ts";

type KalshiAdapterWire = {
  payload: unknown;
  observedAtMs: number;
};

export type KalshiEventsAdapterOptions = Omit<
  FetchKalshiEventsPageOptions,
  "seriesTicker" | "status" | "limit" | "cursor"
> & {
  now?: () => number;
};

export function createKalshiEventsSourceAdapter(
  options: KalshiEventsAdapterOptions = {},
): SourceAdapter<KalshiInventoryEvent, PartialSourceObservation> {
  const definition = kalshiDefinition();
  const now = options.now ?? Date.now;
  const health = new SourceAdapterHealthState("Kalshi", definition, now);
  return {
    definition,
    async fetchPage(request) {
      health.beforeRequest();
      assertRequest(request, definition);
      try {
        const payload = await fetchKalshiEventsPageWire({
          ...options,
          seriesTicker: asSeriesTicker(request.selector.parameters.series!),
          status: request.selector.parameters.status,
          limit: request.limit,
          cursor: request.cursor,
        });
        return { payload, observedAtMs: health.observedAtMs() } satisfies KalshiAdapterWire;
      } catch (cause) {
        health.fail();
        throw cause;
      }
    },
    parsePage(wire, request) {
      try {
        const envelope = parseEnvelope(wire);
        const parsed = parseKalshiEventsPageWire(
          envelope.payload,
          asSeriesTicker(request.selector.parameters.series!),
        );
        if (parsed.nextCursor !== undefined && parsed.nextCursor === request.cursor) {
          throw new Error("Kalshi inventory cursor did not advance");
        }
        return {
          request,
          observedAtMs: envelope.observedAtMs,
          records: parsed.events,
          ...(parsed.nextCursor ? { nextCursor: parsed.nextCursor } : {}),
          exhausted: parsed.nextCursor === undefined,
        };
      } catch (cause) {
        health.fail();
        throw cause;
      }
    },
    project(page, binding) {
      try {
        assertBinding(binding, page.request);
        const observations = page.records.map((event) =>
          projectEvent(event, page, binding, definition),
        );
        health.succeed(page.observedAtMs);
        return observations;
      } catch (cause) {
        health.fail();
        throw cause;
      }
    },
    health: () => health.read(),
  };
}

export function createKalshiEventsInventoryAdapter(
  options: KalshiEventsAdapterOptions = {},
): InventorySourceAdapter {
  return inventorySourceAdapter(createKalshiEventsSourceAdapter(options));
}

function projectEvent(
  event: KalshiInventoryEvent,
  page: SourcePage<KalshiInventoryEvent>,
  binding: CompetitionBinding,
  definition: AdapterDefinition,
): PartialSourceObservation {
  const identityField = binding.identityFields[0]!;
  const participants = participantsForEvent(event, identityField);
  const participantIds = new Set(participants.map((row) => unbrand(row.id)));
  const sourceUpdatedAtMs = timestampMs(event.last_updated_ts);
  const startsAtMs = consistentStartAtMs(event.markets);
  return {
    source: SOURCE.kalshi,
    sport: page.request.selector.sport!,
    eventId: asSourceEventId(unbrandEventStore(event.event_ticker)),
    snapshotCompleteness: "partial",
    collectionCompleteness: "complete",
    title: event.title,
    ...(startsAtMs === undefined ? {} : { startsAtMs }),
    eventType: binding.eventTypes[0]!,
    participantFormat: binding.participantFormats[0]!,
    participants,
    markets: event.markets.map((market) =>
      projectMarket(market, binding, identityField, participantIds),
    ),
    provenance: {
      adapter: definition.id,
      selector: page.request.selector,
      observedAtMs: page.observedAtMs,
      ...(sourceUpdatedAtMs === undefined ? {} : { sourceUpdatedAtMs }),
      ...(page.request.inventoryRunId === undefined
        ? {}
        : { inventoryRunId: page.request.inventoryRunId }),
    },
  };
}

function participantsForEvent(
  event: KalshiInventoryEvent,
  identityField: CompetitionBinding["identityFields"][number],
): NormalizedSourceParticipant[] {
  if (identityField === IDENTITY.none) return [];
  const byId = new Map<string, { id: SourceParticipantId; label: string }>();
  for (const market of event.markets) {
    const competitor = competitorIdForMarket(market, identityField);
    if (!competitor) continue;
    const id = asSourceParticipantId(unbrandEventStore(competitor));
    const key = unbrand(id);
    const label = market.yes_sub_title?.trim();
    if (!label) throw new Error(`Kalshi market is missing participant label: ${unbrandEventStore(market.ticker)}`);
    const existing = byId.get(key);
    if (existing && existing.label !== label) {
      throw new Error(`Kalshi participant label drift: ${key}`);
    }
    byId.set(key, { id, label });
  }
  return [...byId.values()].map((row, ordinal) => ({ ...row, ordinal }));
}

function projectMarket(
  market: KalshiMarketWire,
  binding: CompetitionBinding,
  identityField: CompetitionBinding["identityFields"][number],
  participantIds: ReadonlySet<string>,
): PartialSourceMarket {
  const competitor = competitorIdForMarket(market, identityField);
  if (identityField !== IDENTITY.none && !competitor) {
    throw new Error(`Kalshi market is missing ${unbrand(identityField)} identity`);
  }
  if (market.market_type !== "binary") {
    throw new Error(`Kalshi market type must be binary: ${market.market_type}`);
  }
  const subjectParticipantId = competitor
    ? asSourceParticipantId(unbrandEventStore(competitor))
    : null;
  if (subjectParticipantId && !participantIds.has(unbrand(subjectParticipantId))) {
    throw new Error(`Kalshi market participant missing from event: ${unbrand(subjectParticipantId)}`);
  }
  const sourceUpdatedAtMs = timestampMs(market.updated_time);
  const last = probability(market.last_price_dollars, "last_price_dollars");
  const closesAtMs = timestampMs(market.close_time);
  const result = market.result?.trim();
  const volume = nonnegative(market.volume_fp, "volume_fp");
  const volume24h = nonnegative(market.volume_24h_fp, "volume_24h_fp");
  const openInterest = nonnegative(market.open_interest_fp, "open_interest_fp");
  const yesBid = probability(market.yes_bid_dollars, "yes_bid_dollars");
  const yesAsk = probability(market.yes_ask_dollars, "yes_ask_dollars");
  const noBid = probability(market.no_bid_dollars, "no_bid_dollars");
  const noAsk = probability(market.no_ask_dollars, "no_ask_dollars");
  return {
    id: asSourceMarketId(unbrandEventStore(market.ticker)),
    sourceMarketType: asSourceMarketType(market.market_type!),
    marketKind: binding.marketKinds[0]!,
    title: market.title!,
    status: market.status,
    ...(closesAtMs === undefined ? {} : { closesAtMs }),
    ...(result ? { result } : {}),
    ...(sourceUpdatedAtMs === undefined ? {} : { sourceUpdatedAtMs }),
    ...(subjectParticipantId ? { subjectParticipantId } : {}),
    ...(volume === undefined ? {} : { volume }),
    ...(volume24h === undefined ? {} : { volume24h }),
    ...(openInterest === undefined ? {} : { openInterest }),
    outcomes: [
      {
        outcome: asOutcomeKey("yes"),
        ordinal: 0,
        label: "Yes",
        ...(subjectParticipantId ? { participantId: subjectParticipantId } : {}),
        ...(yesBid === undefined ? {} : { bid: yesBid }),
        ...(yesAsk === undefined ? {} : { ask: yesAsk }),
        ...(last === undefined ? {} : { last }),
      },
      {
        outcome: asOutcomeKey("no"),
        ordinal: 1,
        label: "No",
        ...(noBid === undefined ? {} : { bid: noBid }),
        ...(noAsk === undefined ? {} : { ask: noAsk }),
        ...(last === undefined ? {} : { last: complement(last) }),
      },
    ],
  };
}

function assertRequest(request: SourceFetchRequest, definition: AdapterDefinition): void {
  if (request.selector.kind !== SELECTOR.kalshiSeries) {
    throw new Error("Kalshi adapter requires a series selector");
  }
  const errors = definition.validateSelector(request.selector);
  if (errors.length > 0) throw new Error(`invalid Kalshi selector: ${errors.join(", ")}`);
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 200) {
    throw new Error("Kalshi inventory page limit must be a safe integer in [1, 200]");
  }
}

function assertBinding(binding: CompetitionBinding, request: SourceFetchRequest): void {
  if (
    binding.selector.kind !== request.selector.kind ||
    binding.selector.scope !== request.selector.scope ||
    binding.selector.sport !== request.selector.sport ||
    !recordsEqual(binding.selector.parameters, request.selector.parameters)
  ) {
    throw new Error("Kalshi binding does not match page request");
  }
  if (
    binding.eventTypes.length !== 1 ||
    binding.participantFormats.length !== 1 ||
    binding.marketKinds.length !== 1 ||
    binding.identityFields.length !== 1
  ) {
    throw new Error("Kalshi binding must have singular event, participant, market, and identity semantics");
  }
}

function kalshiDefinition(): AdapterDefinition {
  const definition = ADAPTERS.find((row) => row.id === ADAPTER.kalshiEvents);
  if (!definition) throw new Error("Kalshi adapter definition missing");
  return definition;
}

function parseEnvelope(wire: unknown): KalshiAdapterWire {
  if (
    !isRecord(wire) ||
    typeof wire.observedAtMs !== "number" ||
    !Number.isSafeInteger(wire.observedAtMs) ||
    wire.observedAtMs < 0
  ) {
    throw new Error("Kalshi adapter envelope is invalid");
  }
  return { payload: wire.payload, observedAtMs: wire.observedAtMs };
}

function consistentStartAtMs(markets: readonly KalshiMarketWire[]): number | undefined {
  const values = new Set(
    markets.flatMap((market) => {
      const value = timestampMs(market.occurrence_datetime);
      return value === undefined ? [] : [value];
    }),
  );
  if (values.size > 1) throw new Error("Kalshi event markets disagree on occurrence_datetime");
  return values.values().next().value as number | undefined;
}

function timestampMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Date.parse(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid Kalshi timestamp: ${raw}`);
  return value;
}

function nonnegative(raw: string | undefined, field: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Kalshi ${field} must be a non-negative decimal`);
  }
  return value;
}

function probability(raw: string | undefined, field: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Kalshi ${field} must be a probability`);
  }
  return value;
}

function complement(value: number): number {
  return Number((1 - value).toFixed(12));
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const entries = Object.entries(left);
  return (
    entries.length === Object.keys(right).length &&
    entries.every(([key, value]) => right[key] === value)
  );
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}
