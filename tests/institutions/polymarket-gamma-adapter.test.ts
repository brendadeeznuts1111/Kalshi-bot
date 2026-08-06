import { describe, expect, test } from 'bun:test';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import { runRegisteredSourceInventory } from '../../src/institutions/event-store/source-inventory-runner.ts';
import { listSourceEvents } from '../../src/institutions/event-store/source-market-store.ts';
import {
  classifyPolymarketEventSemantics,
  createPolymarketGammaInventoryAdapter,
  createPolymarketGammaSourceAdapter,
} from '../../src/institutions/market-registry/adapters/polymarket-gamma.ts';
import {
  asSourceInventoryRunId,
  MARKET,
  SOURCE,
  SPORT,
  unbrand,
} from '../../src/institutions/market-registry/brands.ts';
import { registrationFor } from '../../src/institutions/market-registry/registry.ts';
import type { SourceFetchRequest } from '../../src/institutions/market-registry/types.ts';

const registration = registrationFor(SOURCE.polymarket, SPORT.tableTennis)!;
const binding = registration.competitions[0]!;
const tennisBinding = registrationFor(SOURCE.polymarket, SPORT.tennis)!.competitions[0]!;

function request(overrides: Partial<SourceFetchRequest> = {}): SourceFetchRequest {
  return {
    selector: binding.selector,
    pageIndex: 0,
    limit: 100,
    ...overrides,
  };
}

function eventWire(markets: unknown = [marketWire()]) {
  return {
    id: 'event-1',
    ticker: 'tt-event',
    slug: 'player-a-player-b',
    title: 'Player A vs Player B',
    volume: '100',
    volume24hr: '25',
    liquidity: '20',
    liquidityClob: '15',
    openInterest: '12',
    active: true,
    closed: false,
    startDate: '2026-08-04T12:00:00Z',
    endDate: '2026-08-04T13:00:00Z',
    updatedAt: '2026-08-04T11:00:00Z',
    seriesSlug: 'ttelite-games',
    series: [{ id: '12324', slug: 'ttelite-games', title: 'TT Elite Series' }],
    tags: [{ id: '103767', slug: 'table-tennis', label: 'Table Tennis' }],
    markets,
  };
}

function marketWire() {
  return {
    id: 'market-1',
    slug: 'winner',
    question: 'Player A vs Player B winner',
    conditionId: 'condition-1',
    outcomes: '["No","Yes"]',
    outcomePrices: '["0.3","0.7"]',
    volume: '90',
    volume24hr: '20',
    liquidity: '19',
    liquidityClob: '14',
    openInterest: '11',
    lastTradePrice: '0.3',
    bestBid: '0.28',
    bestAsk: '0.32',
    sportsMarketType: 'moneyline',
    active: true,
    closed: false,
    createdAt: '2026-08-04T10:00:00Z',
    updatedAt: '2026-08-04T11:00:00Z',
    endDate: '2026-08-04T13:00:00Z',
  };
}

describe('Polymarket Gamma inventory adapter', () => {
  test('runs the registered table-tennis tag through durable inventory', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const adapter = createPolymarketGammaInventoryAdapter({
      now: () => 1_000,
      fetchImpl: async () =>
        Response.json({
          events: [
            eventWire([
              {
                ...marketWire(),
                outcomes: '["Player A","Player B"]',
                outcomePrices: '["0.7","0.3"]',
              },
            ]),
          ],
          next_cursor: null,
        }),
    });
    const results = await runRegisteredSourceInventory(db, {
      adapters: [adapter],
      sports: [SPORT.tableTennis],
      sources: [SOURCE.polymarket],
      now: () => 900,
      mintRunId: () => asSourceInventoryRunId('polymarket-table-tennis-inventory'),
    });

    expect(results).toMatchObject([{ state: 'complete', observedEventCount: 1 }]);
    expect(listSourceEvents(db, { source: SOURCE.polymarket, sport: SPORT.tableTennis })).toEqual([
      expect.objectContaining({ title: 'Player A vs Player B' }),
    ]);
    expect(
      db.query(
        `SELECT source_participant_id AS participantId
         FROM source_market_outcomes
         ORDER BY ordinal`,
      ).all(),
    ).toEqual([
      { participantId: 'outcome:player a' },
      { participantId: 'outcome:player b' },
    ]);
    db.close();
  });

  test('uses the registered tag cursor and preserves literal outcome identity', async () => {
    let requestedUrl: URL | undefined;
    const adapter = createPolymarketGammaSourceAdapter({
      now: () => 1_000,
      fetchImpl: async input => {
        requestedUrl = new URL(String(input));
        return Response.json({ events: [eventWire()], next_cursor: 'next-page' });
      },
    });
    const sourceRequest = request({ cursor: 'current-page' });
    const wire = await adapter.fetchPage(sourceRequest);
    const page = adapter.parsePage(wire, sourceRequest);
    const [observation] = adapter.project(page, binding);

    expect(requestedUrl?.pathname).toBe('/events/keyset');
    expect(requestedUrl?.searchParams.get('tag_id')).toBe('103767');
    expect(requestedUrl?.searchParams.get('after_cursor')).toBe('current-page');
    expect(requestedUrl?.searchParams.get('limit')).toBe('100');
    expect(page).toMatchObject({ nextCursor: 'next-page', exhausted: false });
    expect(observation?.snapshotCompleteness).toBe('complete');
    expect(observation?.eventType).toBeNull();
    expect(observation?.participantFormat).toBeNull();
    expect(observation?.markets[0]).toMatchObject({
      marketKind: MARKET.matchWinner,
      volume: 90,
      volume24h: 20,
      liquidity: 19,
      clobLiquidity: 14,
      openInterest: 11,
    });
    expect(
      observation?.markets[0]?.outcomes.map(row => ({
        key: unbrand(row.outcome),
        label: row.label,
        probability: row.probability,
        bid: row.bid,
        ask: row.ask,
        last: row.last,
      }))
    ).toEqual([
      { key: 'no', label: 'No', probability: 0.3, bid: 0.28, ask: 0.32, last: 0.3 },
      { key: 'yes', label: 'Yes', probability: 0.7, bid: 0.68, ask: 0.72, last: 0.7 },
    ]);
  });

  test('resolves a registered series only with a literal participant moneyline', () => {
    const adapter = createPolymarketGammaSourceAdapter({ now: () => 1_000 });
    const sourceRequest = request();
    const page = adapter.parsePage(
      {
        payload: {
          events: [
            eventWire([
              {
                ...marketWire(),
                outcomes: '["Player A","Player B"]',
                outcomePrices: '["0.7","0.3"]',
              },
            ]),
          ],
        },
        observedAtMs: 1_000,
      },
      sourceRequest,
    );
    const [observation] = adapter.project(page, binding);
    expect(classifyPolymarketEventSemantics(page.records[0]!, binding)).toMatchObject({
      disposition: 'resolved',
      eventType: 'match',
      participantFormat: 'singles',
    });
    expect(observation).toMatchObject({
      eventType: 'match',
      participantFormat: 'singles',
    });
    expect(observation?.participants.map(participant => ({
      ...participant,
      id: String(participant.id),
    }))).toEqual([
      { id: 'outcome:player a', ordinal: 0, label: 'Player A' },
      { id: 'outcome:player b', ordinal: 1, label: 'Player B' },
    ]);
    expect(
      observation?.markets[0]?.outcomes.map(outcome => String(outcome.participantId)),
    ).toEqual(['outcome:player a', 'outcome:player b']);
  });

  test('keeps durable match semantics when the unique moneyline has closed', () => {
    const adapter = createPolymarketGammaSourceAdapter({ now: () => 1_000 });
    const sourceRequest = request();
    const page = adapter.parsePage(
      {
        payload: {
          events: [
            eventWire([
              {
                ...marketWire(),
                outcomes: '["Player A","Player B"]',
                closed: true,
              },
            ]),
          ],
        },
        observedAtMs: 1_000,
      },
      sourceRequest,
    );
    expect(classifyPolymarketEventSemantics(page.records[0]!, binding)).toMatchObject({
      disposition: 'resolved',
      eventType: 'match',
      participantFormat: 'singles',
    });
  });

  test('resolves strict tournament-winner contracts and keeps propositions quarantined', () => {
    const adapter = createPolymarketGammaSourceAdapter({ now: () => 1_000 });
    const sourceRequest: SourceFetchRequest = {
      selector: tennisBinding.selector,
      pageIndex: 0,
      limit: 100,
    };
    const participantMarket = (id: string, player: string) => ({
      ...marketWire(),
      id,
      slug: id,
      question: `Will ${player} win?`,
      conditionId: `condition-${id}`,
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.4","0.6"]',
      sportsMarketType: undefined,
      groupItemTitle: player,
    });
    const tournament = {
      ...eventWire([
        participantMarket('player-a-market', 'Player A'),
        participantMarket('player-b-market', 'Player B'),
      ]),
      title: 'Cincinnati Open: Winner',
      description:
        "This market resolves to the winner of the men's singles title in the tournament.",
      seriesSlug: undefined,
      series: [],
      tags: [{ id: '864', slug: null, label: null }],
    };
    const page = adapter.parsePage(
      { payload: { events: [tournament] }, observedAtMs: 1_000 },
      sourceRequest,
    );
    const [observation] = adapter.project(page, tennisBinding);
    expect(classifyPolymarketEventSemantics(page.records[0]!, tennisBinding)).toMatchObject({
      disposition: 'resolved',
      eventType: 'tournament',
      participantFormat: 'field',
    });
    expect(observation?.participants.map(participant => ({
      ...participant,
      id: String(participant.id),
    }))).toEqual([
      { id: 'market:player-a-market', ordinal: 0, label: 'Player A' },
      { id: 'market:player-b-market', ordinal: 1, label: 'Player B' },
    ]);
    expect(observation?.markets.map(market => String(market.subjectParticipantId))).toEqual([
      'market:player-a-market',
      'market:player-b-market',
    ]);
    expect(observation?.markets.map(market => market.marketKind)).toEqual([
      MARKET.tournamentWinner,
      MARKET.tournamentWinner,
    ]);

    const propositionPage = adapter.parsePage(
      {
        payload: {
          events: [
            {
              ...tournament,
              id: 'ranking-prop',
              title: 'Will Player A finish 2026 as world #1?',
            },
          ],
        },
        observedAtMs: 1_001,
      },
      sourceRequest,
    );
    expect(
      classifyPolymarketEventSemantics(propositionPage.records[0]!, tennisBinding),
    ).toMatchObject({ disposition: 'quarantined' });
  });

  test('quarantines selector drift and unknown series instead of defaulting to singles', () => {
    const adapter = createPolymarketGammaSourceAdapter({ now: () => 1_000 });
    const sourceRequest = request();
    const project = (wire: ReturnType<typeof eventWire>) => {
      const page = adapter.parsePage(
        { payload: { events: [wire] }, observedAtMs: 1_000 },
        sourceRequest,
      );
      return { event: page.records[0]!, observation: adapter.project(page, binding)[0]! };
    };

    const missingTag = project({ ...eventWire(), tags: [] });
    expect(classifyPolymarketEventSemantics(missingTag.event, binding)).toEqual({
      disposition: 'quarantined',
      reason: 'selector_tag_missing',
    });
    expect(missingTag.observation).toMatchObject({
      eventType: null,
      participantFormat: null,
    });

    const unknownSeries = project({
      ...eventWire(),
      seriesSlug: 'future-team-league',
      series: [{ id: 'future', slug: 'future-team-league', title: 'Future league' }],
    });
    expect(classifyPolymarketEventSemantics(unknownSeries.event, binding)).toEqual({
      disposition: 'quarantined',
      reason: 'unsupported_series',
    });
  });

  test('rejects missing nested markets instead of authoritatively retiring them', async () => {
    const adapter = createPolymarketGammaSourceAdapter({ now: () => 1_000 });
    const sourceRequest = request();
    expect(() =>
      adapter.parsePage(
        {
          payload: { events: [{ ...eventWire(), markets: undefined }] },
          observedAtMs: 1_000,
        },
        sourceRequest
      )
    ).toThrow('markets array required');
    expect(adapter.health().state).toBe('degraded');
  });

  test('opens the circuit on repeated parse failures without recording false success', async () => {
    let now = 1_000;
    const adapter = createPolymarketGammaSourceAdapter({
      now: () => now,
      fetchImpl: async () => Response.json({ events: [{ ...eventWire(), markets: undefined }] }),
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const wire = await adapter.fetchPage(request());
      expect(() => adapter.parsePage(wire, request())).toThrow('markets array required');
      now += 1;
    }
    expect(adapter.health()).toMatchObject({
      state: 'circuit_open',
      consecutiveFailures: 3,
    });
    expect(adapter.health().lastSuccessAtMs).toBeUndefined();
  });

  test('rejects malformed source timestamps before they can clear stored values', async () => {
    const timestampCases = [
      { event: { startDate: 'not-a-date' }, market: {} },
      { event: { endDate: 'not-a-date' }, market: {} },
      { event: { updatedAt: 'not-a-date' }, market: {} },
      { event: {}, market: { endDate: 'not-a-date' } },
      { event: {}, market: { updatedAt: 'not-a-date' } },
    ];
    for (const row of timestampCases) {
      const adapter = createPolymarketGammaSourceAdapter({ now: () => 1_000 });
      const sourceRequest = request();
      const sourceEvent = {
        ...eventWire(),
        ...row.event,
        markets: [{ ...marketWire(), ...row.market }],
      };
      const page = adapter.parsePage(
        { payload: { events: [sourceEvent] }, observedAtMs: 1_000 },
        sourceRequest,
      );
      expect(() => adapter.project(page, binding)).toThrow('invalid Polymarket timestamp');
    }
  });

  test('rejects oversized pages instead of silently changing request provenance', async () => {
    let fetched = false;
    const adapter = createPolymarketGammaSourceAdapter({
      fetchImpl: async () => {
        fetched = true;
        return Response.json({ events: [] });
      },
    });
    for (const limit of [0, -1, 1.5, 501]) {
      await expect(adapter.fetchPage(request({ limit }))).rejects.toThrow(
        'safe integer in [1, 500]'
      );
    }
    expect(fetched).toBe(false);
  });

  test('requires the binding selector parameters to match exactly', async () => {
    const adapter = createPolymarketGammaSourceAdapter({ now: () => 1_000 });
    const sourceRequest = request();
    const page = adapter.parsePage(
      { payload: { events: [eventWire()] }, observedAtMs: 1_000 },
      sourceRequest,
    );
    expect(() =>
      adapter.project(page, {
        ...binding,
        selector: {
          ...binding.selector,
          parameters: { ...binding.selector.parameters, tagSlug: 'drifted' },
        },
      })
    ).toThrow('binding does not match');
  });

  test('opens its health circuit after the registered failure threshold', async () => {
    let now = 1_000;
    const adapter = createPolymarketGammaSourceAdapter({
      now: () => now,
      retries: 0,
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(adapter.fetchPage(request())).rejects.toThrow('503');
      now += 1;
    }
    expect(adapter.health()).toMatchObject({ state: 'circuit_open', consecutiveFailures: 3 });
    await expect(adapter.fetchPage(request())).rejects.toThrow('circuit is open');
  });
});
