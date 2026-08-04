import { describe, expect, test } from 'bun:test';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import {
  planRegisteredSourceMetadata,
  runRegisteredSourceMetadata,
} from '../../src/institutions/event-store/source-metadata-runner.ts';
import {
  asAdapterId,
  asSourceKey,
  asSourceMetadataId,
  asSourceMetadataRunId,
  asSportKey,
  mintSourceMetadataRunId,
  SELECTOR,
  SOURCE,
  SPORT,
  unbrand,
} from '../../src/institutions/market-registry/brands.ts';
import { SPORTS_SOURCE_REGISTRY } from '../../src/institutions/market-registry/registry.ts';
import type {
  AdapterDefinition,
  MetadataFetchRequest,
  NormalizedSourceMetadata,
  RuntimeMetadataSourceAdapter,
} from '../../src/institutions/market-registry/types.ts';

const kalshiDefinition = SPORTS_SOURCE_REGISTRY.adapters.find(
  candidate => candidate.source === SOURCE.kalshi
)!;
const polymarketDefinition = SPORTS_SOURCE_REGISTRY.adapters.find(
  candidate => candidate.source === SOURCE.polymarket
)!;

function kalshiSeries(): NormalizedSourceMetadata {
  return {
    source: SOURCE.kalshi,
    metadataId: asSourceMetadataId('KXATPSETWINNER'),
    metadataKind: SELECTOR.kalshiSeriesMetadata,
    label: 'ATP set winner',
    attributes: { category: 'Sports' },
    facets: { tags: ['Tennis'] },
  };
}

function polymarketSport(): NormalizedSourceMetadata {
  return {
    source: SOURCE.polymarket,
    metadataId: asSourceMetadataId('atp'),
    metadataKind: SELECTOR.polymarketSportsMetadata,
    label: 'ATP',
    attributes: {},
    facets: { tag_ids: ['1', '864', '100639'] },
  };
}

function adapter(input: {
  definition: AdapterDefinition;
  records: readonly NormalizedSourceMetadata[];
  observedAtMs: number;
  fail?: string;
  mutateRequest?: (request: MetadataFetchRequest) => MetadataFetchRequest;
}): RuntimeMetadataSourceAdapter {
  return {
    definition: input.definition,
    async acquirePage(request) {
      if (input.fail) throw new Error(input.fail);
      return {
        request: input.mutateRequest?.(request) ?? request,
        observedAtMs: input.observedAtMs,
        records: input.records,
        completeness: 'complete',
        exhausted: true,
      };
    },
    health: () => ({ state: 'healthy', consecutiveFailures: 0 }),
  };
}

describe('source metadata runner', () => {
  test('plans one source-global acquisition per venue while retaining every sport owner', () => {
    const targets = planRegisteredSourceMetadata(SPORTS_SOURCE_REGISTRY, [
      adapter({ definition: kalshiDefinition, records: [kalshiSeries()], observedAtMs: 200 }),
      adapter({
        definition: polymarketDefinition,
        records: [polymarketSport()],
        observedAtMs: 300,
      }),
    ]);
    expect(
      targets.map(target => ({
        source: unbrand(target.source),
        sports: target.sports.map(unbrand),
        scope: unbrand(target.selector.scope),
      }))
    ).toEqual([
      {
        source: 'kalshi',
        sports: ['table_tennis', 'tennis'],
        scope: 'kalshi:metadata:series',
      },
      {
        source: 'polymarket',
        sports: ['table_tennis', 'tennis'],
        scope: 'polymarket:metadata:sports',
      },
    ]);
  });

  test('acquires and publishes every registered venue through one runner', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const results = await runRegisteredSourceMetadata(db, {
      adapters: [
        adapter({ definition: kalshiDefinition, records: [kalshiSeries()], observedAtMs: 200 }),
        adapter({
          definition: polymarketDefinition,
          records: [polymarketSport()],
          observedAtMs: 300,
        }),
      ],
      now: () => 100,
      mintRunId: source => asSourceMetadataRunId(`${unbrand(source)}-metadata-run`),
    });
    expect(
      results.map(result => ({
        source: unbrand(result.source),
        state: result.state,
        pages: result.pageCount,
        metadata: result.observedMetadataCount,
      }))
    ).toEqual([
      { source: 'kalshi', state: 'complete', pages: 1, metadata: 1 },
      { source: 'polymarket', state: 'complete', pages: 1, metadata: 1 },
    ]);
    expect(
      db.query('SELECT COUNT(*) AS count FROM source_metadata_entities WHERE active = 1').get()
    ).toEqual({ count: 2 });
    expect(
      db.query('SELECT COUNT(*) AS count FROM active_source_metadata_classifications').get()
    ).toEqual({ count: 4 });
  });

  test('isolates one venue failure and continues the remaining registry', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    let clock = 100;
    const results = await runRegisteredSourceMetadata(db, {
      adapters: [
        adapter({
          definition: kalshiDefinition,
          records: [kalshiSeries()],
          observedAtMs: 200,
          fail: 'kalshi 429',
        }),
        adapter({
          definition: polymarketDefinition,
          records: [polymarketSport()],
          observedAtMs: 400,
        }),
      ],
      now: () => (clock += 50),
      mintRunId: source => asSourceMetadataRunId(`${unbrand(source)}-isolated-run`),
    });
    expect(results.map(result => [unbrand(result.source), result.state, result.error])).toEqual([
      ['kalshi', 'failed', 'kalshi 429'],
      ['polymarket', 'complete', undefined],
    ]);
    expect(
      db
        .query(
          `SELECT source_key AS source, state FROM source_metadata_runs
           ORDER BY source_key`
        )
        .all()
    ).toEqual([
      { source: 'kalshi', state: 'failed' },
      { source: 'polymarket', state: 'complete' },
    ]);
  });

  test('fails closed when an adapter returns a request outside its run fence', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const [result] = await runRegisteredSourceMetadata(db, {
      adapters: [
        adapter({
          definition: kalshiDefinition,
          records: [kalshiSeries()],
          observedAtMs: 200,
          mutateRequest: request => ({ ...request, pageIndex: request.pageIndex + 1 }),
        }),
        adapter({
          definition: polymarketDefinition,
          records: [polymarketSport()],
          observedAtMs: 300,
        }),
      ],
      sources: [SOURCE.kalshi],
      now: () => 100,
      mintRunId: () => asSourceMetadataRunId('request-drift-run'),
    });
    expect(result).toMatchObject({
      state: 'failed',
      pageCount: 0,
      error: 'adapter metadata page request does not match acquisition request',
    });
    expect(
      db
        .query("SELECT state FROM source_metadata_runs WHERE metadata_run_id = 'request-drift-run'")
        .get()
    ).toEqual({ state: 'failed' });
  });

  test('supports sport/source targeting without duplicating a venue fetch', () => {
    const adapters = [
      adapter({ definition: kalshiDefinition, records: [kalshiSeries()], observedAtMs: 200 }),
      adapter({
        definition: polymarketDefinition,
        records: [polymarketSport()],
        observedAtMs: 300,
      }),
    ];
    expect(
      planRegisteredSourceMetadata(
        SPORTS_SOURCE_REGISTRY,
        adapters,
        [SOURCE.polymarket],
        [SPORT.tableTennis]
      ).map(target => ({ source: target.source, sports: target.sports }))
    ).toEqual([{ source: SOURCE.polymarket, sports: [SPORT.tableTennis, SPORT.tennis] }]);
    expect(() => planRegisteredSourceMetadata(SPORTS_SOURCE_REGISTRY, [adapters[0]!])).toThrow(
      'runtime metadata adapter missing: polymarket-gamma-v1'
    );
    expect(() =>
      planRegisteredSourceMetadata(SPORTS_SOURCE_REGISTRY, adapters, [asSourceKey('unknown')])
    ).toThrow('unknown metadata source filter: unknown');
    expect(() =>
      planRegisteredSourceMetadata(SPORTS_SOURCE_REGISTRY, adapters, undefined, [
        asSportKey('unknown'),
      ])
    ).toThrow('unknown metadata sport filter: unknown');
  });

  test('fences the complete registered runtime definition and nonblank run entropy', () => {
    const drifted = adapter({
      definition: { ...kalshiDefinition, parserVersion: kalshiDefinition.parserVersion + 1 },
      records: [kalshiSeries()],
      observedAtMs: 200,
    });
    expect(() =>
      planRegisteredSourceMetadata(SPORTS_SOURCE_REGISTRY, [
        drifted,
        adapter({
          definition: polymarketDefinition,
          records: [polymarketSport()],
          observedAtMs: 300,
        }),
      ])
    ).toThrow('runtime metadata adapter definition drift: kalshi-events-v1');
    expect(() =>
      mintSourceMetadataRunId(SOURCE.kalshi, kalshiDefinition.metadataDiscovery!.scope, '  ')
    ).toThrow('SourceMetadataRunId entropy required');
  });

  test('rejects ambiguous discovery authority when one source owns multiple adapters', () => {
    const secondDefinition: AdapterDefinition = {
      ...kalshiDefinition,
      id: asAdapterId('kalshi-table-metadata-v1'),
    };
    const splitRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      adapters: [...SPORTS_SOURCE_REGISTRY.adapters, secondDefinition],
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map(registration =>
        registration.source === SOURCE.kalshi && registration.sport === SPORT.tableTennis
          ? { ...registration, adapter: secondDefinition.id }
          : registration
      ),
    };
    expect(() =>
      planRegisteredSourceMetadata(splitRegistry, [
        adapter({ definition: kalshiDefinition, records: [kalshiSeries()], observedAtMs: 200 }),
        adapter({ definition: secondDefinition, records: [kalshiSeries()], observedAtMs: 200 }),
        adapter({
          definition: polymarketDefinition,
          records: [polymarketSport()],
          observedAtMs: 300,
        }),
      ])
    ).toThrow('ambiguous metadata discovery adapters for source: kalshi');
  });

  test('invalid adapter clocks and blank errors finalize the owned run', async () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const [invalidClock] = await runRegisteredSourceMetadata(db, {
      adapters: [
        adapter({ definition: kalshiDefinition, records: [kalshiSeries()], observedAtMs: NaN }),
        adapter({
          definition: polymarketDefinition,
          records: [polymarketSport()],
          observedAtMs: 300,
        }),
      ],
      sources: [SOURCE.kalshi],
      now: () => 100,
      mintRunId: () => asSourceMetadataRunId('invalid-clock-run'),
    });
    expect(invalidClock).toMatchObject({
      state: 'failed',
      error: 'observedAtMs must be a timestamp',
    });
    expect(
      db
        .query("SELECT state FROM source_metadata_runs WHERE metadata_run_id = 'invalid-clock-run'")
        .get()
    ).toEqual({ state: 'failed' });

    const [blankFailure] = await runRegisteredSourceMetadata(db, {
      adapters: [
        adapter({
          definition: kalshiDefinition,
          records: [kalshiSeries()],
          observedAtMs: 400,
          fail: ' ',
        }),
        adapter({
          definition: polymarketDefinition,
          records: [polymarketSport()],
          observedAtMs: 500,
        }),
      ],
      sources: [SOURCE.kalshi],
      now: () => 350,
      mintRunId: () => asSourceMetadataRunId('blank-error-run'),
    });
    expect(blankFailure).toMatchObject({
      state: 'failed',
      error: 'unknown metadata acquisition failure',
    });
    expect(
      db
        .query("SELECT state FROM source_metadata_runs WHERE metadata_run_id = 'blank-error-run'")
        .get()
    ).toEqual({ state: 'failed' });
  });
});
