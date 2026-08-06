import { describe, expect, test } from 'bun:test';
import { openEventStore } from '../../src/institutions/event-store/open-db.ts';
import { buildSportsSourceDiscoveryArtifact } from '../../src/institutions/event-store/source-metadata-read.ts';
import {
  beginSourceMetadataRun,
  commitSourceMetadataPage,
  failSourceMetadataRun,
} from '../../src/institutions/event-store/source-metadata-run.ts';
import { reclassifySourceMetadata } from '../../src/institutions/event-store/source-metadata-store.ts';
import {
  asSourceMetadataId,
  asSourceMetadataRunId,
  SELECTOR,
  SOURCE,
} from '../../src/institutions/market-registry/brands.ts';
import { SPORTS_SOURCE_REGISTRY } from '../../src/institutions/market-registry/registry.ts';
import type { NormalizedSourceMetadata } from '../../src/institutions/market-registry/types.ts';

const adapter = SPORTS_SOURCE_REGISTRY.adapters.find(
  candidate => candidate.source === SOURCE.kalshi
)!;
const selector = adapter.metadataDiscovery!;
const GENERATED_AT = new Date(500).toISOString();

function entity(): NormalizedSourceMetadata {
  return {
    source: SOURCE.kalshi,
    metadataId: asSourceMetadataId('KXATPSETWINNER'),
    metadataKind: SELECTOR.kalshiSeriesMetadata,
    label: 'ATP set winner',
    attributes: { category: 'Sports' },
    facets: { tags: ['Tennis'] },
    sourceUpdatedAtMs: 150,
  };
}

function publishKalshi(db: ReturnType<typeof openEventStore>): void {
  const runId = asSourceMetadataRunId('kalshi-read-model-complete');
  beginSourceMetadataRun(db, {
    runId,
    source: SOURCE.kalshi,
    adapter: adapter.id,
    selector,
    startedAtMs: 100,
  });
  commitSourceMetadataPage(db, {
    source: SOURCE.kalshi,
    page: {
      request: { selector, metadataRunId: runId, pageIndex: 0 },
      observedAtMs: 200,
      records: [entity()],
      completeness: 'complete',
      exhausted: true,
    },
  });
}

describe('sport/source metadata discovery read model', () => {
  test('emits every declared sport/source cell before the first acquisition', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    const artifact = buildSportsSourceDiscoveryArtifact(db, GENERATED_AT);
    expect(artifact.schema).toBe('sports-source-discovery/v1');
    expect(artifact.cells.map(cell => `${cell.sport}:${cell.source}`)).toEqual([
      'tennis:kalshi',
      'tennis:polymarket',
      'table_tennis:kalshi',
      'table_tennis:polymarket',
    ]);
    expect(artifact.cells.every(cell => cell.latestRun.state === 'never_run')).toBe(true);
    expect(
      artifact.cells.every(
        cell =>
          cell.snapshot.runFingerprintState === 'unobserved' &&
          cell.snapshot.classificationFingerprintState === 'unobserved' &&
          cell.snapshot.servingStale === false &&
          cell.snapshot.servingExpired === false &&
          cell.counts.registered === 0 &&
          cell.counts.quarantined === 0 &&
          cell.counts.ignored === 0
      )
    ).toBe(true);
    expect(() => buildSportsSourceDiscoveryArtifact(db, '2026-08-04')).toThrow(
      'generatedAt must be an ISO timestamp'
    );
  });

  test('projects active classifications per sport without emitting ignored records', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    publishKalshi(db);
    const artifact = buildSportsSourceDiscoveryArtifact(db, GENERATED_AT);
    const tennis = artifact.cells.find(
      cell => cell.sport === 'tennis' && cell.source === 'kalshi'
    )!;
    expect(tennis.latestRun).toMatchObject({
      state: 'complete',
      runId: 'kalshi-read-model-complete',
      observedMetadataCount: 1,
    });
    expect(tennis.snapshot).toEqual({
      runId: 'kalshi-read-model-complete',
      observedAtMs: 200,
      ageMs: 300,
      freshForMs: 1_800_000,
      staleForMs: 86_400_000,
      servingStale: false,
      servingExpired: false,
      runFingerprintState: 'current',
      classificationFingerprintState: 'current',
    });
    expect(tennis.counts).toEqual({ registered: 1, quarantined: 0, ignored: 0 });
    expect(tennis.registered).toEqual([
      {
        metadataKind: 'kalshi_series_metadata',
        metadataId: 'KXATPSETWINNER',
        label: 'ATP set winner',
        sourceUpdatedAtMs: 150,
        reasonCode: 'exact_registry_match',
        matchedSelectorScope: 'kalshi:series:KXATPSETWINNER',
      },
    ]);
    const tableTennis = artifact.cells.find(
      cell => cell.sport === 'table_tennis' && cell.source === 'kalshi'
    )!;
    expect(tableTennis.counts).toEqual({ registered: 0, quarantined: 0, ignored: 1 });
    expect(tableTennis.registered).toEqual([]);
    expect(tableTennis.quarantined).toEqual([]);

    const stale = buildSportsSourceDiscoveryArtifact(
      db,
      new Date(200 + 1_800_000).toISOString()
    ).cells.find(cell => cell.sport === 'tennis' && cell.source === 'kalshi')!;
    expect(stale.snapshot).toMatchObject({
      ageMs: 1_800_000,
      freshForMs: 1_800_000,
      staleForMs: 86_400_000,
      servingStale: true,
      servingExpired: false,
    });

    const expired = buildSportsSourceDiscoveryArtifact(
      db,
      new Date(200 + 86_400_000).toISOString()
    ).cells.find(cell => cell.sport === 'tennis' && cell.source === 'kalshi')!;
    expect(expired.snapshot).toMatchObject({
      ageMs: 86_400_000,
      freshForMs: 1_800_000,
      staleForMs: 86_400_000,
      servingStale: true,
      servingExpired: true,
      runFingerprintState: 'current',
      classificationFingerprintState: 'current',
    });

    const future = buildSportsSourceDiscoveryArtifact(db, new Date(199).toISOString()).cells.find(
      cell => cell.sport === 'tennis' && cell.source === 'kalshi'
    )!;
    expect(future.snapshot).toMatchObject({
      ageMs: 0,
      futureByMs: 1,
      servingStale: true,
      servingExpired: false,
    });
  });

  test('uses attempt sequence when a later attempt has a regressed provider clock', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    publishKalshi(db);
    const failedRun = asSourceMetadataRunId('kalshi-read-model-failed');
    beginSourceMetadataRun(db, {
      runId: failedRun,
      source: SOURCE.kalshi,
      adapter: adapter.id,
      selector,
      startedAtMs: 150,
    });
    failSourceMetadataRun(db, {
      source: SOURCE.kalshi,
      runId: failedRun,
      failedAtMs: 160,
      detail: '429',
    });
    const artifact = buildSportsSourceDiscoveryArtifact(db, GENERATED_AT);
    const tennis = artifact.cells.find(
      cell => cell.sport === 'tennis' && cell.source === 'kalshi'
    )!;
    expect(tennis.latestRun).toMatchObject({
      state: 'failed',
      runId: 'kalshi-read-model-failed',
      error: '429',
      attemptSequence: 2,
    });
    expect(tennis.snapshot).toMatchObject({
      runId: 'kalshi-read-model-complete',
      servingStale: true,
      runFingerprintState: 'current',
      classificationFingerprintState: 'current',
    });
    expect(tennis.counts.registered).toBe(1);
  });

  test('signals registry drift and remains deterministic for a fixed generation time', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    publishKalshi(db);
    const changedRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      sports: SPORTS_SOURCE_REGISTRY.sports.map((sport, index) =>
        index === 0 ? { ...sport, label: `${sport.label} v2` } : sport
      ),
    };
    const first = buildSportsSourceDiscoveryArtifact(db, GENERATED_AT, changedRegistry);
    const second = buildSportsSourceDiscoveryArtifact(db, GENERATED_AT, changedRegistry);
    expect(first).toEqual(second);
    const tennis = first.cells.find(cell => cell.sport === 'tennis' && cell.source === 'kalshi')!;
    expect(tennis.snapshot).toMatchObject({
      servingStale: true,
      runFingerprintState: 'stale',
      classificationFingerprintState: 'stale',
    });

    reclassifySourceMetadata(db, { classifiedAtMs: 300 }, changedRegistry);
    const reclassified = buildSportsSourceDiscoveryArtifact(db, GENERATED_AT, changedRegistry);
    expect(
      reclassified.cells.find(cell => cell.sport === 'tennis' && cell.source === 'kalshi')
        ?.snapshot
    ).toMatchObject({
      servingStale: true,
      runFingerprintState: 'stale',
      classificationFingerprintState: 'current',
    });
  });

  test('does not serve a historical run from a different selector authority', () => {
    const db = openEventStore({ dbPath: ':memory:' });
    db.query(
      `INSERT INTO source_metadata_runs (
         source_key, metadata_run_id, selector_scope, adapter_id, selector_kind,
         selector_parameters_json, registry_fingerprint, state, started_at_ms,
         checkpoint_at_ms, finished_at_ms, exhausted
       ) VALUES (
         'kalshi', 'historical-other-scope', 'kalshi:metadata:legacy',
         'kalshi-events-v1', 'kalshi_series_metadata', '{}', 'historical',
         'complete', 100, 200, 200, 1
       )`
    ).run();
    db.query(
      `INSERT INTO source_metadata_run_attempts (source_key, metadata_run_id)
       VALUES ('kalshi', 'historical-other-scope')`
    ).run();

    const artifact = buildSportsSourceDiscoveryArtifact(db, GENERATED_AT);
    const tennis = artifact.cells.find(
      cell => cell.sport === 'tennis' && cell.source === 'kalshi'
    )!;
    expect(tennis.latestRun).toEqual({ state: 'never_run' });
    expect(tennis.snapshot).toEqual({
      servingStale: false,
      servingExpired: false,
      runFingerprintState: 'unobserved',
      classificationFingerprintState: 'unobserved',
    });
  });
});
