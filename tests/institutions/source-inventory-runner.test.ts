import { describe, expect, test } from 'bun:test';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import {
  planRegisteredSourceInventory,
  runRegisteredSourceInventory,
} from '../../src/institutions/event-store/source-inventory-runner.ts';
import { listSourceEvents } from '../../src/institutions/event-store/source-market-store.ts';
import {
  asOutcomeKey,
  asSourceEventId,
  asSourceInventoryRunId,
  asSourceMarketId,
  asSourceScopeId,
  SOURCE,
  SPORT,
  unbrand,
} from '../../src/institutions/market-registry/brands.ts';
import {
  ADAPTERS,
  registrationFor,
  SOURCES,
  SPORTS,
  SPORTS_SOURCE_REGISTRY,
} from '../../src/institutions/market-registry/registry.ts';
import {
  inventorySourceAdapter,
  type CompetitionBinding,
  type CompleteSourceObservation,
  type SourceAdapter,
  type SourceFetchRequest,
  type SourcePage,
  type SportsSourceRegistry,
} from '../../src/institutions/market-registry/types.ts';

type TestRow = { event: string };

const baseRegistration = registrationFor(
  SOURCE.polymarket,
  SPORT.tableTennis,
  SPORTS_SOURCE_REGISTRY
)!;
const baseBinding = baseRegistration.competitions[0]!;

function registryWithBindings(bindings: readonly CompetitionBinding[]): SportsSourceRegistry {
  return {
    sports: SPORTS,
    sources: SOURCES,
    adapters: ADAPTERS,
    integrations: [{ ...baseRegistration, competitions: bindings }],
  };
}

function observation(
  row: TestRow,
  request: SourceFetchRequest,
  observedAtMs: number
): CompleteSourceObservation {
  return {
    source: SOURCE.polymarket,
    sport: SPORT.tableTennis,
    eventId: asSourceEventId(row.event),
    snapshotCompleteness: 'complete',
    title: row.event,
    status: 'open',
    closesAtMs: null,
    result: null,
    startsAtMs: null,
    eventType: 'match',
    participantFormat: 'singles',
    participants: [],
    markets: [
      {
        id: asSourceMarketId(`${row.event}-winner`),
        sourceMarketType: null,
        marketKind: null,
        title: `${row.event} winner`,
        status: 'open',
        closesAtMs: null,
        result: null,
        subjectParticipantId: null,
        volume: null,
        volume24h: null,
        liquidity: null,
        clobLiquidity: null,
        openInterest: null,
        outcomes: [
          {
            outcome: asOutcomeKey('yes'),
            ordinal: 0,
            label: 'Yes',
            participantId: null,
            probability: 0.5,
            bid: null,
            ask: null,
            last: null,
            lastTradeAtMs: null,
          },
        ],
      },
    ],
    provenance: {
      adapter: baseRegistration.adapter,
      selector: request.selector,
      observedAtMs,
    },
  };
}

function fakeAdapter(acquire: (request: SourceFetchRequest) => SourcePage<TestRow>) {
  const adapter: SourceAdapter<TestRow, CompleteSourceObservation> = {
    definition: ADAPTERS.find(row => row.id === baseRegistration.adapter)!,
    async fetchPage(request) {
      return acquire(request);
    },
    parsePage(wire) {
      return wire as SourcePage<TestRow>;
    },
    project(page) {
      return page.records.map(row => observation(row, page.request, page.observedAtMs));
    },
    health: () => ({ state: 'healthy', consecutiveFailures: 0 }),
  };
  return inventorySourceAdapter(adapter);
}

describe('registered source inventory runner', () => {
  test('plans every operational selector in deterministic registry order', () => {
    const kalshi = fakeAdapter(() => {
      throw new Error('not called');
    });
    const polymarket = kalshi;
    const targets = planRegisteredSourceInventory(SPORTS_SOURCE_REGISTRY, [
      polymarket,
      {
        ...kalshi,
        definition: ADAPTERS.find(row => row.source === SOURCE.kalshi)!,
      },
    ]);

    expect(targets).toHaveLength(49);
    expect(targets.some(row => row.sport === SPORT.tableTennis)).toBe(true);
    expect(targets.map(row => unbrand(row.binding.selector.scope))).toEqual(
      [...targets]
        .sort((left, right) =>
          `${unbrand(left.integration)}:${unbrand(left.binding.selector.scope)}`.localeCompare(
            `${unbrand(right.integration)}:${unbrand(right.binding.selector.scope)}`
          )
        )
        .map(row => unbrand(row.binding.selector.scope))
    );
  });

  test('fails runtime preflight before creating any runs', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    await expect(
      runRegisteredSourceInventory(db, {
        registry: registryWithBindings([baseBinding]),
        adapters: [],
      })
    ).rejects.toThrow('runtime adapter missing');
    const count = db.query('SELECT COUNT(*) AS count FROM source_inventory_runs').get() as {
      count: number;
    };
    expect(count.count).toBe(0);
    db.close();
  });

  test('walks cursor pages and persists every normalized observation', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const requests: SourceFetchRequest[] = [];
    const adapter = fakeAdapter(request => {
      requests.push(request);
      const first = request.cursor === undefined;
      return {
        request,
        observedAtMs: first ? 1_000 : 1_100,
        records: [{ event: first ? 'event-a' : 'event-b' }],
        ...(first ? { nextCursor: 'cursor-b' } : {}),
        exhausted: !first,
      };
    });

    const results = await runRegisteredSourceInventory(db, {
      registry: registryWithBindings([baseBinding]),
      adapters: [adapter],
      pageSize: 25,
      now: () => 900,
      mintRunId: () => asSourceInventoryRunId('runner-success'),
    });

    expect(requests.map(row => [row.pageIndex, row.cursor, row.limit])).toEqual([
      [0, undefined, 25],
      [1, 'cursor-b', 25],
    ]);
    expect(results).toMatchObject([{ state: 'complete', pageCount: 2, observedEventCount: 2 }]);
    expect(
      listSourceEvents(db, { source: SOURCE.polymarket, sport: SPORT.tableTennis }).map(row =>
        unbrand(row.eventId)
      )
    ).toEqual(['event-a', 'event-b']);
    db.close();
  });

  test('records one failed selector and continues the next registry scope', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const secondBinding: CompetitionBinding = {
      ...baseBinding,
      selector: {
        ...baseBinding.selector,
        scope: asSourceScopeId('polymarket:tag:second'),
        parameters: { ...baseBinding.selector.parameters, tagId: 'second' },
      },
    };
    const adapter = fakeAdapter(request => {
      if (request.selector.scope === baseBinding.selector.scope) {
        throw new Error('upstream unavailable');
      }
      return {
        request,
        observedAtMs: 1_000,
        records: [{ event: 'event-survivor' }],
        exhausted: true,
      };
    });

    const results = await runRegisteredSourceInventory(db, {
      registry: registryWithBindings([baseBinding, secondBinding]),
      adapters: [adapter],
      now: () => 900,
      mintRunId: (_source, _sport, binding) =>
        asSourceInventoryRunId(`run:${unbrand(binding.selector.scope)}`),
    });

    expect(results.map(row => [unbrand(row.binding.selector.scope), row.state])).toEqual([
      [unbrand(baseBinding.selector.scope), 'failed'],
      [unbrand(secondBinding.selector.scope), 'complete'],
    ]);
    expect(results[0]?.error).toBe('upstream unavailable');
    expect(
      listSourceEvents(db, { source: SOURCE.polymarket, sport: SPORT.tableTennis }).map(row =>
        unbrand(row.eventId)
      )
    ).toEqual(['event-survivor']);
    db.close();
  });

  test('rejects adapter request drift before persistence', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const adapter = fakeAdapter(request => ({
      request: { ...request, limit: request.limit + 1 },
      observedAtMs: 1_000,
      records: [{ event: 'must-not-write' }],
      exhausted: true,
    }));

    const [result] = await runRegisteredSourceInventory(db, {
      registry: registryWithBindings([baseBinding]),
      adapters: [adapter],
      now: () => 900,
      mintRunId: () => asSourceInventoryRunId('runner-drift'),
    });

    expect(result).toMatchObject({
      state: 'failed',
      pageCount: 0,
      observedEventCount: 0,
      error: 'adapter page request does not match inventory request',
    });
    expect(listSourceEvents(db, { source: SOURCE.polymarket, sport: SPORT.tableTennis })).toEqual(
      []
    );
    db.close();
  });
});
