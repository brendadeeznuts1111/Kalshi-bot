import {
  fetchPolymarketEventsPageWire,
  parsePolymarketEventsPageWire,
  type FetchEventsPageOptions,
  type PolymarketEvent,
  type PolymarketMarket,
} from '../../../regulatory/integrations/polymarket.ts';
import {
  asOutcomeKey,
  asSourceEventId,
  asSourceMarketId,
  asSourceMarketType,
  asSourceTagId,
  ADAPTER,
  SELECTOR,
  SOURCE,
  unbrand,
} from '../brands.ts';
import { ADAPTERS } from '../registry.ts';
import {
  inventorySourceAdapter,
  type AdapterDefinition,
  type CompetitionBinding,
  type CompleteSourceMarket,
  type CompleteSourceObservation,
  type InventorySourceAdapter,
  type SourceAdapter,
  type SourceFetchRequest,
  type SourcePage,
} from '../types.ts';
import { SourceAdapterHealthState } from './health.ts';

type PolymarketAdapterWire = {
  payload: unknown;
  observedAtMs: number;
};

export type PolymarketGammaAdapterOptions = Omit<
  FetchEventsPageOptions,
  'pageSize' | 'tagId' | 'tagSlug' | 'afterCursor'
> & {
  now?: () => number;
};

export function createPolymarketGammaSourceAdapter(
  options: PolymarketGammaAdapterOptions = {}
): SourceAdapter<PolymarketEvent, CompleteSourceObservation> {
  const definition = polymarketDefinition();
  const now = options.now ?? Date.now;
  const health = new SourceAdapterHealthState('Polymarket', definition, now);
  return {
    definition,
    async fetchPage(request) {
      health.beforeRequest();
      assertRequest(request, definition);
      try {
        const payload = await fetchPolymarketEventsPageWire({
          ...options,
          tagId: asSourceTagId(request.selector.parameters.tagId!),
          tagSlug: request.selector.parameters.tagSlug,
          pageSize: request.limit,
          afterCursor: request.cursor,
        });
        const observedAtMs = health.observedAtMs();
        return { payload, observedAtMs } satisfies PolymarketAdapterWire;
      } catch (cause) {
        health.fail();
        throw cause;
      }
    },
    parsePage(wire, request) {
      try {
        const envelope = parseEnvelope(wire);
        const parsed = parsePolymarketEventsPageWire(envelope.payload);
        if (parsed.nextCursor !== undefined && parsed.nextCursor === request.cursor) {
          throw new Error('Polymarket inventory cursor did not advance');
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
        const observations = page.records.map(event =>
          projectEvent(event, page, binding, definition)
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

export function createPolymarketGammaInventoryAdapter(
  options: PolymarketGammaAdapterOptions = {}
): InventorySourceAdapter {
  return inventorySourceAdapter(createPolymarketGammaSourceAdapter(options));
}

function projectEvent(
  event: PolymarketEvent,
  page: SourcePage<PolymarketEvent>,
  binding: CompetitionBinding,
  definition: AdapterDefinition
): CompleteSourceObservation {
  const sourceUpdatedAtMs = dateMs(event.updatedAt);
  return {
    source: SOURCE.polymarket,
    sport: page.request.selector.sport!,
    eventId: asSourceEventId(event.id),
    snapshotCompleteness: 'complete',
    title: event.title,
    status: event.closed ? 'closed' : event.active ? 'active' : 'inactive',
    closesAtMs: dateMs(event.endDate) ?? null,
    result: null,
    startsAtMs: dateMs(event.startDate) ?? null,
    eventType: null,
    participantFormat: null,
    participants: [],
    markets: event.markets.map(market => projectMarket(market, event, binding)),
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

function projectMarket(
  market: PolymarketMarket,
  event: PolymarketEvent,
  binding: CompetitionBinding
): CompleteSourceMarket {
  const sourceMarketType = market.sportsMarketType
    ? asSourceMarketType(market.sportsMarketType)
    : null;
  const mapping = sourceMarketType
    ? binding.sourceMarketMappings.find(row => row.sourceMarketType === sourceMarketType)
    : undefined;
  if (sourceMarketType && !mapping && binding.unmappedMarketPolicy === 'reject') {
    throw new Error(`unmapped Polymarket market type: ${unbrand(sourceMarketType)}`);
  }
  const sourceUpdatedAtMs = dateMs(market.updatedAt);
  const outcomeKeys = new Set<string>();
  const binary = market.outcomes.length === 2;
  return {
    id: asSourceMarketId(market.id),
    sourceMarketType,
    marketKind: mapping?.marketKind ?? null,
    title: market.question,
    status: market.closed ? 'closed' : market.active ? 'active' : 'inactive',
    closesAtMs: dateMs(market.endDate ?? event.endDate) ?? null,
    result: null,
    ...(sourceUpdatedAtMs === undefined ? {} : { sourceUpdatedAtMs }),
    subjectParticipantId: null,
    volume: market.volume,
    volume24h: market.volume24hr,
    liquidity: market.liquidity,
    clobLiquidity: market.liquidityClob,
    openInterest: market.openInterest ?? null,
    outcomes: market.outcomes.map((label, ordinal) => {
      const key = literalOutcomeKey(label);
      if (outcomeKeys.has(key)) {
        throw new Error(`duplicate Polymarket outcome label: ${label}`);
      }
      outcomeKeys.add(key);
      return {
        outcome: asOutcomeKey(key),
        ordinal,
        label,
        participantId: null,
        probability: market.outcomePrices[ordinal] ?? null,
        bid: binary ? binaryQuote(market.bestBid, market.bestAsk, ordinal, 'bid') : null,
        ask: binary ? binaryQuote(market.bestBid, market.bestAsk, ordinal, 'ask') : null,
        last: binary ? binaryLast(market.lastTradePrice, ordinal) : null,
        lastTradeAtMs: null,
      };
    }),
  };
}

function binaryQuote(
  bestBid: number | undefined,
  bestAsk: number | undefined,
  ordinal: number,
  side: 'bid' | 'ask'
): number | null {
  if (ordinal === 0) return (side === 'bid' ? bestBid : bestAsk) ?? null;
  const opposite = side === 'bid' ? bestAsk : bestBid;
  return opposite === undefined ? null : complement(opposite);
}

function binaryLast(last: number | null, ordinal: number): number | null {
  if (last === null) return null;
  return ordinal === 0 ? last : complement(last);
}

function complement(value: number): number {
  return Number((1 - value).toFixed(12));
}

function literalOutcomeKey(label: string): string {
  const key = label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!key) throw new Error('Polymarket outcome label required');
  return key;
}

function assertRequest(request: SourceFetchRequest, definition: AdapterDefinition): void {
  if (request.selector.kind !== SELECTOR.polymarketTag) {
    throw new Error('Polymarket adapter requires a tag selector');
  }
  const errors = definition.validateSelector(request.selector);
  if (errors.length > 0) throw new Error(`invalid Polymarket selector: ${errors.join(', ')}`);
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 500) {
    throw new Error('Polymarket inventory page limit must be a safe integer in [1, 500]');
  }
}

function assertBinding(binding: CompetitionBinding, request: SourceFetchRequest): void {
  if (
    binding.selector.kind !== request.selector.kind ||
    binding.selector.scope !== request.selector.scope ||
    binding.selector.sport !== request.selector.sport ||
    !recordsEqual(binding.selector.parameters, request.selector.parameters)
  ) {
    throw new Error('Polymarket binding does not match page request');
  }
}

function polymarketDefinition(): AdapterDefinition {
  const definition = ADAPTERS.find(row => row.id === ADAPTER.polymarketGamma);
  if (!definition) throw new Error('Polymarket adapter definition missing');
  return definition;
}

function parseEnvelope(wire: unknown): PolymarketAdapterWire {
  if (
    !isRecord(wire) ||
    typeof wire.observedAtMs !== 'number' ||
    !Number.isSafeInteger(wire.observedAtMs) ||
    wire.observedAtMs < 0
  ) {
    throw new Error('Polymarket adapter envelope is invalid');
  }
  return { payload: wire.payload, observedAtMs: wire.observedAtMs as number };
}

function dateMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Date.parse(raw);
  if (!Number.isFinite(value)) throw new Error(`invalid Polymarket timestamp: ${raw}`);
  return value;
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const entries = Object.entries(left);
  return (
    entries.length === Object.keys(right).length &&
    entries.every(([key, value]) => right[key] === value)
  );
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}
