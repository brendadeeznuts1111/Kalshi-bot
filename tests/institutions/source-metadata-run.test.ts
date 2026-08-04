import { describe, expect, test } from 'bun:test';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import {
  beginSourceMetadataRun,
  commitSourceMetadataPage,
  failSourceMetadataRun,
  resumeSourceMetadataRun,
} from '../../src/institutions/event-store/source-metadata-run.ts';
import {
  reclassifySourceMetadata,
  sourceRegistryFingerprint,
} from '../../src/institutions/event-store/source-metadata-store.ts';
import {
  asSourceMetadataId,
  asSourceMetadataRunId,
  SELECTOR,
  SOURCE,
} from '../../src/institutions/market-registry/brands.ts';
import { SPORTS_SOURCE_REGISTRY } from '../../src/institutions/market-registry/registry.ts';
import type {
  MetadataPage,
  NormalizedSourceMetadata,
  SourceSelector,
} from '../../src/institutions/market-registry/types.ts';

const adapter = SPORTS_SOURCE_REGISTRY.adapters.find(
  candidate => candidate.source === SOURCE.kalshi
)!;
const selector = adapter.metadataDiscovery!;

function series(ticker: string, tags: readonly string[] = ['Tennis']): NormalizedSourceMetadata {
  return {
    source: SOURCE.kalshi,
    metadataId: asSourceMetadataId(ticker),
    metadataKind: SELECTOR.kalshiSeriesMetadata,
    label: ticker,
    attributes: { category: 'Sports' },
    facets: { tags },
  };
}

function begin(
  db: ReturnType<typeof openEventStore>,
  runId: ReturnType<typeof asSourceMetadataRunId>,
  startedAtMs: number,
  runSelector: SourceSelector = selector
) {
  return beginSourceMetadataRun(db, {
    runId,
    source: SOURCE.kalshi,
    adapter: adapter.id,
    selector: runSelector,
    startedAtMs,
  });
}

function page(input: {
  runId: ReturnType<typeof asSourceMetadataRunId>;
  pageIndex?: number;
  observedAtMs: number;
  records: readonly NormalizedSourceMetadata[];
  completeness?: 'complete' | 'partial';
  requestCursor?: string;
  nextCursor?: string;
  requestSelector?: SourceSelector;
}): MetadataPage<NormalizedSourceMetadata> {
  return {
    request: {
      selector: input.requestSelector ?? selector,
      metadataRunId: input.runId,
      pageIndex: input.pageIndex ?? 0,
      ...(input.requestCursor === undefined ? {} : { cursor: input.requestCursor }),
    },
    observedAtMs: input.observedAtMs,
    records: input.records,
    completeness: input.completeness ?? 'complete',
    ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor }),
    exhausted: input.nextCursor === undefined,
  };
}

describe('source metadata runs', () => {
  test('publishes a complete snapshot and retires only entities absent from its successor', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const firstRun = asSourceMetadataRunId('metadata-run-1');
    begin(db, firstRun, 100);
    expect(
      commitSourceMetadataPage(db, {
        source: SOURCE.kalshi,
        page: page({
          runId: firstRun,
          observedAtMs: 200,
          records: [series('KXATPSETWINNER'), series('KXWTASETWINNER')],
        }),
      })
    ).toMatchObject({ state: 'complete', pageCount: 1, observedMetadataCount: 2 });
    expect(
      db
        .query(
          `SELECT metadata_id AS metadataId, active
           FROM source_metadata_entities ORDER BY metadata_id`
        )
        .all()
    ).toEqual([
      { metadataId: 'KXATPSETWINNER', active: 1 },
      { metadataId: 'KXWTASETWINNER', active: 1 },
    ]);
    expect(db.query('SELECT COUNT(*) AS count FROM source_metadata_classifications').get()).toEqual(
      { count: 4 }
    );

    const secondRun = asSourceMetadataRunId('metadata-run-2');
    begin(db, secondRun, 300);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({
        runId: secondRun,
        observedAtMs: 400,
        records: [series('KXATPSETWINNER')],
      }),
    });
    expect(
      db
        .query(
          `SELECT metadata_id AS metadataId, active
           FROM source_metadata_entities ORDER BY metadata_id`
        )
        .all()
    ).toEqual([
      { metadataId: 'KXATPSETWINNER', active: 1 },
      { metadataId: 'KXWTASETWINNER', active: 0 },
    ]);
  });

  test('a partial terminal snapshot is failed and cannot retire current metadata', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const completeRun = asSourceMetadataRunId('metadata-complete');
    begin(db, completeRun, 100);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({
        runId: completeRun,
        observedAtMs: 200,
        records: [series('KXATPSETWINNER')],
      }),
    });

    const partialRun = asSourceMetadataRunId('metadata-partial');
    begin(db, partialRun, 300);
    expect(
      commitSourceMetadataPage(db, {
        source: SOURCE.kalshi,
        page: page({
          runId: partialRun,
          observedAtMs: 400,
          records: [series('KXUNREGISTERED')],
          completeness: 'partial',
        }),
      })
    ).toMatchObject({ state: 'failed', partialPageCount: 1 });
    expect(
      db
        .query(
          `SELECT metadata_id AS metadataId, active
           FROM source_metadata_entities ORDER BY metadata_id`
        )
        .all()
    ).toEqual([{ metadataId: 'KXATPSETWINNER', active: 1 }]);
    expect(
      db
        .query(
          `SELECT metadata_id AS metadataId
           FROM source_metadata_run_entities
           WHERE metadata_run_id = $runId`
        )
        .all({ $runId: partialRun })
    ).toEqual([{ metadataId: 'KXUNREGISTERED' }]);
    expect(
      db.query('SELECT COUNT(*) AS count FROM active_source_metadata_classifications').get()
    ).toEqual({ count: 2 });
  });

  test('a failed partial revision cannot overwrite published entity truth', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const completeRun = asSourceMetadataRunId('metadata-current');
    begin(db, completeRun, 100);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({
        runId: completeRun,
        observedAtMs: 200,
        records: [{ ...series('KXATPSETWINNER'), label: 'current', sourceUpdatedAtMs: 500 }],
      }),
    });
    const partialRun = asSourceMetadataRunId('metadata-overwrite');
    begin(db, partialRun, 300);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({
        runId: partialRun,
        observedAtMs: 400,
        completeness: 'partial',
        records: [
          {
            ...series('KXATPSETWINNER', []),
            label: 'partial-overwrite',
            sourceUpdatedAtMs: 600,
          },
        ],
      }),
    });
    expect(
      db
        .query(
          `SELECT label, source_updated_at_ms AS sourceUpdatedAtMs,
                  last_seen_run_id AS lastSeenRunId
           FROM source_metadata_entities WHERE metadata_id = 'KXATPSETWINNER'`
        )
        .get()
    ).toEqual({ label: 'current', sourceUpdatedAtMs: 500, lastSeenRunId: completeRun });
    expect(
      db
        .query(
          `SELECT disposition, reason_code AS reasonCode
           FROM active_source_metadata_classifications
           WHERE metadata_id = 'KXATPSETWINNER' AND sport_key = 'tennis'`
        )
        .get()
    ).toEqual({ disposition: 'registered', reasonCode: 'exact_registry_match' });
  });

  test('replays the last committed page idempotently and fences a mutated replay', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const runId = asSourceMetadataRunId('metadata-replay');
    begin(db, runId, 100);
    const terminal = {
      source: SOURCE.kalshi,
      page: page({
        runId,
        observedAtMs: 200,
        records: [series('KXATPSETWINNER')],
      }),
    };
    expect(commitSourceMetadataPage(db, terminal)).toMatchObject({ pageCount: 1 });
    expect(commitSourceMetadataPage(db, terminal)).toMatchObject({ pageCount: 1 });
    expect(() =>
      commitSourceMetadataPage(db, {
        ...terminal,
        page: { ...terminal.page, records: [series('KXWTASETWINNER')] },
      })
    ).toThrow('source metadata run is complete');
    expect(db.query('SELECT COUNT(*) AS count FROM source_metadata_run_pages').get()).toEqual({
      count: 1,
    });
  });

  test('failed runs fence late pages and preserve active membership', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const seedRun = asSourceMetadataRunId('metadata-seed');
    begin(db, seedRun, 100);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({ runId: seedRun, observedAtMs: 200, records: [series('KXATPSETWINNER')] }),
    });
    const failedRun = asSourceMetadataRunId('metadata-failed');
    begin(db, failedRun, 300);
    failSourceMetadataRun(db, {
      source: SOURCE.kalshi,
      runId: failedRun,
      failedAtMs: 350,
      detail: '429',
    });
    expect(() =>
      commitSourceMetadataPage(db, {
        source: SOURCE.kalshi,
        page: page({
          runId: failedRun,
          observedAtMs: 400,
          records: [series('KXWTASETWINNER')],
        }),
      })
    ).toThrow('source metadata run is failed');
    expect(
      db.query('SELECT COUNT(*) AS count FROM source_metadata_entities WHERE active = 1').get()
    ).toEqual({ count: 1 });
  });

  test('an empty complete snapshot cannot retire current metadata', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const seedRun = asSourceMetadataRunId('metadata-empty-seed');
    begin(db, seedRun, 100);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({ runId: seedRun, observedAtMs: 200, records: [series('KXATPSETWINNER')] }),
    });
    const emptyRun = asSourceMetadataRunId('metadata-empty');
    begin(db, emptyRun, 300);
    expect(() =>
      commitSourceMetadataPage(db, {
        source: SOURCE.kalshi,
        page: page({ runId: emptyRun, observedAtMs: 400, records: [] }),
      })
    ).toThrow('complete metadata snapshot must not be empty');
    expect(resumeSourceMetadataRun(db, SOURCE.kalshi, emptyRun)).toMatchObject({
      state: 'running',
      pageCount: 0,
    });
    expect(
      db.query('SELECT COUNT(*) AS count FROM source_metadata_entities WHERE active = 1').get()
    ).toEqual({ count: 1 });
  });

  test('rejects older snapshots and selectors outside the registered discovery contract', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const newerRun = asSourceMetadataRunId('metadata-newer');
    begin(db, newerRun, 100);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({ runId: newerRun, observedAtMs: 500, records: [series('KXATPSETWINNER')] }),
    });
    const staleRun = asSourceMetadataRunId('metadata-stale');
    begin(db, staleRun, 200);
    expect(() =>
      commitSourceMetadataPage(db, {
        source: SOURCE.kalshi,
        page: page({
          runId: staleRun,
          observedAtMs: 400,
          records: [series('KXWTASETWINNER')],
        }),
      })
    ).toThrow('not newer than the persisted source checkpoint');

    const badSelector = {
      ...selector,
      parameters: { ...selector.parameters, category: 'Entertainment' },
    };
    expect(() =>
      begin(db, asSourceMetadataRunId('metadata-bad-selector'), 600, badSelector)
    ).toThrow('exact registered discovery selector');
    expect(resumeSourceMetadataRun(db, SOURCE.kalshi, staleRun)).toMatchObject({
      state: 'running',
      pageCount: 0,
    });
  });

  test('requires strictly newer snapshots and rejects provider-version regression', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const firstRun = asSourceMetadataRunId('metadata-clock-first');
    begin(db, firstRun, 100);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({
        runId: firstRun,
        observedAtMs: 500,
        records: [
          { ...series('KXATPSETWINNER'), sourceUpdatedAtMs: 700 },
          series('KXWTASETWINNER'),
        ],
      }),
    });

    const equalRun = asSourceMetadataRunId('metadata-clock-equal');
    begin(db, equalRun, 200);
    expect(() =>
      commitSourceMetadataPage(db, {
        source: SOURCE.kalshi,
        page: page({
          runId: equalRun,
          observedAtMs: 500,
          records: [series('KXATPSETWINNER')],
        }),
      })
    ).toThrow('not newer than the persisted source checkpoint');
    failSourceMetadataRun(db, {
      source: SOURCE.kalshi,
      runId: equalRun,
      failedAtMs: 501,
      detail: 'non-monotonic snapshot',
    });

    const regressedRun = asSourceMetadataRunId('metadata-provider-regressed');
    begin(db, regressedRun, 600);
    expect(() =>
      commitSourceMetadataPage(db, {
        source: SOURCE.kalshi,
        page: page({
          runId: regressedRun,
          observedAtMs: 800,
          records: [{ ...series('KXATPSETWINNER'), sourceUpdatedAtMs: 650 }],
        }),
      })
    ).toThrow('metadata provider timestamp regressed');
    expect(
      db
        .query(
          `SELECT source_updated_at_ms AS sourceUpdatedAtMs
           FROM source_metadata_entities WHERE metadata_id = 'KXATPSETWINNER'`
        )
        .get()
    ).toEqual({ sourceUpdatedAtMs: 700 });
  });

  test('pins registry semantics for the entire metadata run', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const runId = asSourceMetadataRunId('metadata-registry-fence');
    begin(db, runId, 100);
    const changedRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      sports: SPORTS_SOURCE_REGISTRY.sports.map((sport, index) =>
        index === 0 ? { ...sport, label: `${sport.label} changed` } : sport
      ),
    };
    expect(() =>
      commitSourceMetadataPage(
        db,
        {
          source: SOURCE.kalshi,
          page: page({
            runId,
            observedAtMs: 200,
            records: [series('KXATPSETWINNER')],
          }),
        },
        changedRegistry
      )
    ).toThrow('source metadata registry changed during the run');
    expect(resumeSourceMetadataRun(db, SOURCE.kalshi, runId)).toMatchObject({ pageCount: 0 });
  });

  test('reclassifies persisted source truth without fetching it again', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const runId = asSourceMetadataRunId('metadata-reclassify');
    begin(db, runId, 100);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({ runId, observedAtMs: 200, records: [series('KXATPSETWINNER')] }),
    });
    const partialRun = asSourceMetadataRunId('metadata-reclassify-partial');
    begin(db, partialRun, 220);
    commitSourceMetadataPage(db, {
      source: SOURCE.kalshi,
      page: page({
        runId: partialRun,
        observedAtMs: 250,
        completeness: 'partial',
        records: [series('KXUNPUBLISHED')],
      }),
    });
    db.query("UPDATE source_metadata_classifications SET registry_fingerprint = 'stale'").run();
    const result = reclassifySourceMetadata(db, {
      source: SOURCE.kalshi,
      classifiedAtMs: 300,
    });
    expect(result).toMatchObject({ entityCount: 1, classificationCount: 2 });
    expect(result.registryFingerprint).toBe(sourceRegistryFingerprint());
    expect(
      db
        .query(
          `SELECT DISTINCT registry_fingerprint AS fingerprint, classified_at_ms AS classifiedAtMs
           FROM source_metadata_classifications`
        )
        .all()
    ).toEqual([{ fingerprint: result.registryFingerprint, classifiedAtMs: 300 }]);
  });
});
