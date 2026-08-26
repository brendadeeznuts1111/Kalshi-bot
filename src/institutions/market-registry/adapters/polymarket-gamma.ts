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
  asSourceParticipantId,
  asSourceMarketType,
  asSourceTagId,
  ADAPTER,
  SELECTOR,
  SOURCE,
  unbrand,
} from '../brands.ts';
import { ADAPTERS, resolveEventSemantics } from '../registry.ts';
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
  type EventType,
  type ParticipantFormat,
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
          ...(request.selector.parameters.tagSlug === undefined
            ? {}
            : { tagSlug: request.selector.parameters.tagSlug }),
          pageSize: request.limit,
          ...(request.cursor === undefined ? {} : { afterCursor: request.cursor }),
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
  const semantics = classifyPolymarketEventSemantics(event, binding);
  const participants = projectParticipants(event, semantics);
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
    eventType: semantics.disposition === 'resolved' ? semantics.eventType : null,
    participantFormat:
      semantics.disposition === 'resolved' ? semantics.participantFormat : null,
    participants,
    markets: event.markets.map(market =>
      projectMarket(market, event, binding, semantics, participants)
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

export type PolymarketEventSemanticResolution =
  | {
      disposition: 'resolved';
      eventType: EventType;
      participantFormat: ParticipantFormat;
      evidence: 'registered_series_moneyline' | 'tournament_winner_contract';
    }
  | {
      disposition: 'quarantined';
      reason:
        | 'selector_tag_missing'
        | 'series_evidence_conflict'
        | 'unsupported_series'
        | 'moneyline_shape_unresolved'
        | 'participant_format_conflict'
        | 'participant_identity_conflict'
        | 'unsupported_event_type';
    };

/**
 * Source-specific semantic gate shared by durable inventory and live matching.
 * A broad sport tag is acquisition scope only; reconciliation requires a
 * registered series plus a coherent two-participant moneyline.
 */
export function classifyPolymarketEventSemantics(
  event: PolymarketEvent,
  binding: CompetitionBinding,
): PolymarketEventSemanticResolution {
  const requestedTagId = binding.selector.parameters.tagId;
  if (!requestedTagId || !event.tags.some((tag) => tag.id === requestedTagId)) {
    return { disposition: 'quarantined', reason: 'selector_tag_missing' };
  }
  if (event.seriesConflict) {
    return { disposition: 'quarantined', reason: 'series_evidence_conflict' };
  }
  if (isTournamentWinnerContract(event)) {
    if (!binding.eventTypes.includes('tournament') || !binding.participantFormats.includes('field')) {
      return { disposition: 'quarantined', reason: 'unsupported_event_type' };
    }
    return {
      disposition: 'resolved',
      eventType: 'tournament',
      participantFormat: 'field',
      evidence: 'tournament_winner_contract',
    };
  }
  const seriesSlug = event.seriesSlug;
  const resolved = seriesSlug
    ? resolveEventSemantics(binding, { seriesSlug })
    : null;
  if (!resolved) return { disposition: 'quarantined', reason: 'unsupported_series' };

  const moneylines = event.markets.filter(
    (market) => market.sportsMarketType === 'moneyline'
  );
  if (moneylines.length !== 1) {
    return { disposition: 'quarantined', reason: 'moneyline_shape_unresolved' };
  }
  const outcomes = moneylines[0]!.outcomes.map((outcome) => outcome.trim());
  if (
    outcomes.length !== 2 ||
    outcomes.some((outcome) => !outcome || /^(yes|no|over|under)$/i.test(outcome)) ||
    new Set(outcomes.map(literalOutcomeKey)).size !== 2
  ) {
    return { disposition: 'quarantined', reason: 'moneyline_shape_unresolved' };
  }
  const paired = outcomes.map((outcome) => outcome.includes('/'));
  if (
    (resolved.participantFormat === 'doubles' && !paired.every(Boolean)) ||
    (resolved.participantFormat === 'singles' && paired.some(Boolean))
  ) {
    return { disposition: 'quarantined', reason: 'participant_format_conflict' };
  }
  const completeTeams = event.teams.filter(
    (team): team is typeof team & { id: string; name: string } =>
      team.id !== null && team.name !== null,
  );
  if (
    event.teams.length > 0 &&
    (completeTeams.length !== 2 || !participantSetsAgree(completeTeams.map(team => team.name), outcomes))
  ) {
    return { disposition: 'quarantined', reason: 'participant_identity_conflict' };
  }
  return {
    disposition: 'resolved',
    eventType: resolved.eventType,
    participantFormat: resolved.participantFormat,
    evidence: 'registered_series_moneyline',
  };
}

function isTournamentWinnerContract(event: PolymarketEvent): boolean {
  if (event.markets.some((market) => market.sportsMarketType !== undefined)) return false;
  if (!/\bwinner(?:\s*\(tennis\))?$/i.test(event.title.trim())) return false;
  const description = event.description?.toLowerCase() ?? '';
  if (
    !/(?:\bwinner\b|\bwins?\b|\bsingles title\b)/.test(description) ||
    !/(?:\btournament\b|\bopen\b|\bmasters\b)/.test(description)
  ) {
    return false;
  }
  return tournamentParticipantMarkets(event).length >= 2;
}

function tournamentParticipantMarkets(event: PolymarketEvent): PolymarketMarket[] {
  return event.markets.filter(isTournamentParticipantMarket);
}

function isTournamentParticipantMarket(market: PolymarketMarket): boolean {
  return (
    Boolean(market.groupItemTitle) &&
    market.outcomes.length === 2 &&
    market.outcomes.every((outcome) => /^(yes|no)$/i.test(outcome.trim()))
  );
}

function participantSetsAgree(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const remaining = [...left];
  for (const candidate of right) {
    const index = remaining.findIndex(value => participantIdentityMatches(value, candidate));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function participantIdentityMatches(left: string, right: string): boolean {
  const normalizedLeft = normalizeParticipantLabel(left);
  const normalizedRight = normalizeParticipantLabel(right);
  if (normalizedLeft === normalizedRight) return true;
  const leftPair = normalizedLeft.split('/').map(value => value.trim()).sort();
  const rightPair = normalizedRight.split('/').map(value => value.trim()).sort();
  if (leftPair.length === 2 || rightPair.length === 2) {
    return (
      leftPair.length === 2 &&
      rightPair.length === 2 &&
      leftPair.every((value, index) => value === rightPair[index])
    );
  }
  const leftTokens = normalizedLeft.split(' ');
  const rightTokens = normalizedRight.split(' ');
  return (
    (leftTokens.length === 1 || rightTokens.length === 1) &&
    leftTokens.at(-1) === rightTokens.at(-1)
  );
}

function normalizeParticipantLabel(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function projectParticipants(
  event: PolymarketEvent,
  semantics: PolymarketEventSemanticResolution,
): CompleteSourceObservation['participants'] {
  if (semantics.disposition !== 'resolved') return [];
  if (semantics.eventType === 'tournament') {
    return tournamentParticipantMarkets(event).map((market, ordinal) => ({
      id: asSourceParticipantId(`market:${market.id}`),
      ordinal,
      label: market.groupItemTitle!,
    }));
  }
  const moneyline = event.markets.find(market => market.sportsMarketType === 'moneyline');
  if (!moneyline) return [];
  const completeTeams = event.teams.filter(
    (team): team is typeof team & { id: string; name: string } =>
      team.id !== null && team.name !== null,
  );
  if (completeTeams.length === 2) {
    return moneyline.outcomes.map((outcome, ordinal) => {
      const team = completeTeams.find(
        candidate => participantIdentityMatches(candidate.name, outcome)
      )!;
      return { id: asSourceParticipantId(team.id), ordinal, label: team.name };
    });
  }
  return moneyline.outcomes.map((label, ordinal) => ({
    id: asSourceParticipantId(`outcome:${literalOutcomeKey(label)}`),
    ordinal,
    label,
  }));
}

function projectMarket(
  market: PolymarketMarket,
  event: PolymarketEvent,
  binding: CompetitionBinding,
  semantics: PolymarketEventSemanticResolution,
  participants: CompleteSourceObservation['participants'],
): CompleteSourceMarket {
  const sourceMarketType = market.sportsMarketType
    ? asSourceMarketType(market.sportsMarketType)
    : null;
  const mapping = sourceMarketType
    ? binding.sourceMarketMappings.find(row => row.sourceMarketType === sourceMarketType)
    : undefined;
  const semanticMapping =
    !sourceMarketType &&
    semantics.disposition === 'resolved' &&
    (semantics.eventType !== 'tournament' || isTournamentParticipantMarket(market))
      ? binding.eventSemanticMarketMappings?.find(
          row =>
            row.eventType === semantics.eventType &&
            row.participantFormat === semantics.participantFormat
        )
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
    marketKind: mapping?.marketKind ?? semanticMapping?.marketKind ?? null,
    title: market.question,
    status: market.closed ? 'closed' : market.active ? 'active' : 'inactive',
    closesAtMs: dateMs(market.endDate ?? event.endDate) ?? null,
    result: null,
    ...(sourceUpdatedAtMs === undefined ? {} : { sourceUpdatedAtMs }),
    subjectParticipantId:
      semantics.disposition === 'resolved' &&
      semantics.eventType === 'tournament' &&
      market.groupItemTitle
        ? asSourceParticipantId(`market:${market.id}`)
        : null,
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
        participantId:
          semantics.disposition === 'resolved' &&
          semantics.eventType === 'match' &&
          market.sportsMarketType === 'moneyline'
            ? participants[ordinal]?.id ?? null
            : null,
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
