import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
  asAdapterId,
  asSelectorKind,
  asSourceKey,
  asSourceMetadataRunId,
  asSourceRegistryFingerprint,
  asSourceScopeId,
  unbrand,
  type AdapterId,
  type SelectorKind,
  type SourceKey,
  type SourceMetadataRunId,
  type SourceRegistryFingerprint,
  type SourceScopeId,
} from '../market-registry/brands.ts';
import { classifySourceMetadata } from '../market-registry/metadata-classification.ts';
import { sourceRegistryFingerprint } from '../market-registry/fingerprint.ts';
import { SPORTS_SOURCE_REGISTRY } from '../market-registry/registry.ts';
import type {
  MetadataPage,
  NormalizedSourceMetadata,
  SourceSelector,
  SportsSourceRegistry,
} from '../market-registry/types.ts';
import { assertSportsSourceRegistry } from '../market-registry/validate.ts';
import {
  parseStoredStringRecord,
  promoteCompletedSourceMetadataRun,
} from './source-metadata-store.ts';

export type SourceMetadataRunState = 'running' | 'complete' | 'failed' | 'abandoned';

export type BeginSourceMetadataRunInput = {
  runId: SourceMetadataRunId;
  source: SourceKey;
  adapter: AdapterId;
  selector: SourceSelector;
  startedAtMs: number;
};

export type SourceMetadataRunCheckpoint = {
  runId: SourceMetadataRunId;
  state: SourceMetadataRunState;
  nextCursor?: string;
  pageCount: number;
  partialPageCount: number;
  observedMetadataCount: number;
};

type RunRow = {
  runId: SourceMetadataRunId;
  source: SourceKey;
  selectorScope: SourceScopeId;
  adapter: AdapterId;
  selectorKind: SelectorKind;
  selectorParametersJson: string;
  registryFingerprint: SourceRegistryFingerprint;
  state: SourceMetadataRunState;
  startedAtMs: number;
  checkpointAtMs: number | null;
  nextCursor: string | null;
  lastPageFingerprint: string | null;
  pageCount: number;
  partialPageCount: number;
  observedMetadataCount: number;
};

type RunWireRow = Omit<
  RunRow,
  'runId' | 'source' | 'selectorScope' | 'adapter' | 'selectorKind' | 'registryFingerprint'
> & {
  runId: string; // brand-ok -- parsed immediately after the SQLite boundary
  source: string;
  selectorScope: string;
  adapter: string; // brand-ok -- parsed immediately after the SQLite boundary
  selectorKind: string;
  registryFingerprint: string;
};

export function beginSourceMetadataRun(
  db: Database,
  input: BeginSourceMetadataRunInput,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY
): SourceMetadataRunCheckpoint {
  assertTimestamp(input.startedAtMs, 'startedAtMs');
  assertRegisteredMetadataRun(input, registry);
  const registryFingerprint = sourceRegistryFingerprint(registry);
  const begin = db.transaction(() => {
    const parameters = {
      $source: unbrand(input.source),
      $runId: unbrand(input.runId),
      $selectorScope: unbrand(input.selector.scope),
      $adapter: unbrand(input.adapter),
      $selectorKind: unbrand(input.selector.kind),
      $selectorParameters: canonicalJson(input.selector.parameters),
      $registryFingerprint: unbrand(registryFingerprint),
      $startedAtMs: input.startedAtMs,
    };
    db.query(
      `INSERT INTO source_metadata_runs (
         source_key, metadata_run_id, selector_scope, adapter_id,
         selector_kind, selector_parameters_json, registry_fingerprint,
         state, started_at_ms
       ) VALUES (
         $source, $runId, $selectorScope, $adapter,
         $selectorKind, $selectorParameters, $registryFingerprint,
         'running', $startedAtMs
       )`
    ).run(parameters);
    db.query(
      `INSERT INTO source_metadata_run_attempts (source_key, metadata_run_id)
       VALUES ($source, $runId)`
    ).run({
      $source: unbrand(input.source),
      $runId: unbrand(input.runId),
    });
  });
  begin.immediate();
  return {
    runId: input.runId,
    state: 'running',
    pageCount: 0,
    partialPageCount: 0,
    observedMetadataCount: 0,
  };
}

export function commitSourceMetadataPage(
  db: Database,
  input: { source: SourceKey; page: MetadataPage<NormalizedSourceMetadata> },
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY
): SourceMetadataRunCheckpoint {
  const { page } = input;
  const runId = page.request.metadataRunId;
  if (!runId) throw new Error('metadata page request requires metadataRunId');
  assertTimestamp(page.observedAtMs, 'observedAtMs');
  if (!Number.isSafeInteger(page.request.pageIndex) || page.request.pageIndex < 0) {
    throw new Error('metadata pageIndex must be a non-negative safe integer');
  }
  if (page.exhausted !== (page.nextCursor === undefined)) {
    throw new Error('terminal metadata pages must be exhausted and omit nextCursor');
  }
  if (page.nextCursor !== undefined && !page.nextCursor.trim()) {
    throw new Error('metadata nextCursor must be nonblank');
  }
  if (page.nextCursor !== undefined && page.nextCursor === page.request.cursor) {
    throw new Error('metadata page cursor must advance');
  }
  const ids = new Set<string>();
  for (const entity of page.records) {
    const id = unbrand(entity.metadataId);
    if (ids.has(id)) throw new Error(`duplicate metadata entity: ${id}`);
    ids.add(id);
  }
  const fingerprint = pageFingerprint(page);
  const commit = db.transaction((): SourceMetadataRunCheckpoint => {
    const run = readRun(db, input.source, runId);
    if (!run) throw new Error('source metadata run not found');
    const selector = selectorFromRun(run);
    assertRegisteredMetadataRun(
      {
        runId,
        source: run.source,
        adapter: run.adapter,
        selector,
        startedAtMs: run.startedAtMs,
      },
      registry
    );
    if (sourceRegistryFingerprint(registry) !== run.registryFingerprint) {
      throw new Error('source metadata registry changed during the run');
    }
    assertPageMatchesRun(page, run, selector);
    assertMetadataPageMode(page, run, registry);
    for (const entity of page.records) {
      assertEntityMatchesRun(entity, run);
      classifySourceMetadata(entity, registry);
    }
    if (run.lastPageFingerprint === fingerprint && page.request.pageIndex === run.pageCount - 1) {
      return checkpoint(run);
    }
    if (run.state !== 'running') throw new Error(`source metadata run is ${run.state}`);
    if (
      page.exhausted &&
      page.completeness === 'complete' &&
      run.observedMetadataCount + page.records.length === 0
    ) {
      throw new Error('complete metadata snapshot must not be empty');
    }
    if (page.observedAtMs < run.startedAtMs) {
      throw new Error('metadata page observedAtMs precedes run start');
    }
    if (run.checkpointAtMs !== null && page.observedAtMs < run.checkpointAtMs) {
      throw new Error('metadata page observedAtMs precedes the prior checkpoint');
    }
    if (page.request.pageIndex !== run.pageCount) {
      throw new Error('metadata page index is out of order');
    }
    if ((page.request.cursor ?? null) !== run.nextCursor) {
      throw new Error('metadata request cursor does not match checkpoint');
    }

    const newerCheckpoint = db
      .query(
        `SELECT MAX(checkpoint_at_ms) AS checkpointAtMs
         FROM source_metadata_runs
         WHERE source_key = $source
           AND selector_scope = $selectorScope
           AND metadata_run_id <> $runId`
      )
      .get({
        $source: unbrand(run.source),
        $selectorScope: unbrand(run.selectorScope),
        $runId: unbrand(run.runId),
      }) as { checkpointAtMs: number | null };
    if (
      newerCheckpoint.checkpointAtMs !== null &&
      page.observedAtMs <= newerCheckpoint.checkpointAtMs
    ) {
      throw new Error('metadata page is not newer than the persisted source checkpoint');
    }

    stageMetadataPage(db, run, page);

    db.query(
      `INSERT INTO source_metadata_run_pages (
         source_key, metadata_run_id, page_index, request_cursor, next_cursor,
         observed_at_ms, metadata_count, completeness, exhausted, page_fingerprint
       ) VALUES (
         $source, $runId, $pageIndex, $requestCursor, $nextCursor,
         $observedAtMs, $metadataCount, $completeness, $exhausted, $fingerprint
       )`
    ).run({
      $source: unbrand(run.source),
      $runId: unbrand(run.runId),
      $pageIndex: page.request.pageIndex,
      $requestCursor: page.request.cursor ?? null,
      $nextCursor: page.nextCursor ?? null,
      $observedAtMs: page.observedAtMs,
      $metadataCount: page.records.length,
      $completeness: page.completeness,
      $exhausted: page.exhausted ? 1 : 0,
      $fingerprint: fingerprint,
    });

    const partialPageCount = run.partialPageCount + (page.completeness === 'partial' ? 1 : 0);
    const terminalState: SourceMetadataRunState = partialPageCount === 0 ? 'complete' : 'failed';
    const nextState = page.exhausted ? terminalState : 'running';
    db.query(
      `UPDATE source_metadata_runs
       SET state = $state,
           checkpoint_at_ms = $observedAtMs,
           finished_at_ms = CASE WHEN $exhausted = 1 THEN $observedAtMs ELSE NULL END,
           next_cursor = $nextCursor,
           last_request_cursor = $requestCursor,
           last_page_fingerprint = $fingerprint,
           page_count = page_count + 1,
           partial_page_count = $partialPageCount,
           observed_metadata_count = observed_metadata_count + $metadataCount,
           exhausted = $exhausted,
           error_detail = CASE WHEN $state = 'failed'
             THEN 'partial metadata run is non-authoritative' ELSE NULL END
       WHERE source_key = $source AND metadata_run_id = $runId AND state = 'running'`
    ).run({
      $state: nextState,
      $observedAtMs: page.observedAtMs,
      $exhausted: page.exhausted ? 1 : 0,
      $nextCursor: page.nextCursor ?? null,
      $requestCursor: page.request.cursor ?? null,
      $fingerprint: fingerprint,
      $partialPageCount: partialPageCount,
      $metadataCount: page.records.length,
      $source: unbrand(run.source),
      $runId: unbrand(run.runId),
    });

    if (nextState === 'complete') {
      promoteCompletedSourceMetadataRun(
        db,
        { source: run.source, runId: run.runId, classifiedAtMs: page.observedAtMs },
        registry
      );
      db.query(
        `UPDATE source_metadata_entities
         SET active = 1, retired_at_ms = NULL
         WHERE source_key = $source
           AND selector_scope = $selectorScope
           AND last_seen_run_id = $runId`
      ).run({
        $source: unbrand(run.source),
        $selectorScope: unbrand(run.selectorScope),
        $runId: unbrand(run.runId),
      });
      db.query(
        `UPDATE source_metadata_entities
         SET active = 0, retired_at_ms = $observedAtMs
         WHERE source_key = $source
           AND selector_scope = $selectorScope
           AND active = 1
           AND (last_seen_run_id IS NULL OR last_seen_run_id <> $runId)`
      ).run({
        $observedAtMs: page.observedAtMs,
        $source: unbrand(run.source),
        $selectorScope: unbrand(run.selectorScope),
        $runId: unbrand(run.runId),
      });
    }
    const updated = readRun(db, input.source, runId);
    if (!updated) throw new Error('source metadata run disappeared during commit');
    return checkpoint(updated);
  });
  return commit.immediate();
}

function stageMetadataPage(
  db: Database,
  run: RunRow,
  page: MetadataPage<NormalizedSourceMetadata>
): void {
  const insert = db.query(
    `INSERT INTO source_metadata_run_entities (
       source_key, metadata_run_id, metadata_kind, metadata_id,
       label, attributes_json, facets_json, source_updated_at_ms, observed_at_ms
     ) VALUES (
       $source, $runId, $metadataKind, $metadataId,
       $label, $attributesJson, $facetsJson, $sourceUpdatedAtMs, $observedAtMs
     )`
  );
  for (const entity of page.records) {
    insert.run({
      $source: unbrand(run.source),
      $runId: unbrand(run.runId),
      $metadataKind: unbrand(entity.metadataKind),
      $metadataId: unbrand(entity.metadataId),
      $label: entity.label,
      $attributesJson: canonicalJson(entity.attributes),
      $facetsJson: canonicalJson(entity.facets),
      $sourceUpdatedAtMs: entity.sourceUpdatedAtMs ?? null,
      $observedAtMs: page.observedAtMs,
    });
  }
}

export function failSourceMetadataRun(
  db: Database,
  input: {
    source: SourceKey;
    runId: SourceMetadataRunId;
    failedAtMs: number;
    detail: string;
  }
): void {
  finishWithoutRetirement(db, input.source, input.runId, 'failed', input.failedAtMs, input.detail);
}

export function abandonSourceMetadataRun(
  db: Database,
  input: {
    source: SourceKey;
    runId: SourceMetadataRunId;
    abandonedAtMs: number;
    detail: string;
  }
): void {
  finishWithoutRetirement(
    db,
    input.source,
    input.runId,
    'abandoned',
    input.abandonedAtMs,
    input.detail
  );
}

export function resumeSourceMetadataRun(
  db: Database,
  source: SourceKey,
  runId: SourceMetadataRunId
): SourceMetadataRunCheckpoint {
  const run = readRun(db, source, runId);
  if (!run) throw new Error('source metadata run not found');
  if (run.state !== 'running') throw new Error(`source metadata run is ${run.state}`);
  return checkpoint(run);
}

function finishWithoutRetirement(
  db: Database,
  source: SourceKey,
  runId: SourceMetadataRunId,
  state: 'failed' | 'abandoned',
  finishedAtMs: number,
  detail: string
): void {
  assertTimestamp(finishedAtMs, 'finishedAtMs');
  if (!detail.trim()) throw new Error('metadata run detail required');
  const result = db
    .query(
      `UPDATE source_metadata_runs
       SET state = $state, finished_at_ms = $finishedAtMs, error_detail = $detail
       WHERE source_key = $source AND metadata_run_id = $runId
         AND state = 'running' AND started_at_ms <= $finishedAtMs
         AND (checkpoint_at_ms IS NULL OR checkpoint_at_ms <= $finishedAtMs)`
    )
    .run({
      $state: state,
      $finishedAtMs: finishedAtMs,
      $detail: detail,
      $source: unbrand(source),
      $runId: unbrand(runId),
    });
  if (result.changes !== 1) throw new Error('running source metadata run not found');
}

function readRun(db: Database, source: SourceKey, runId: SourceMetadataRunId): RunRow | null {
  const row = db
    .query(
      `SELECT metadata_run_id AS runId, source_key AS source,
              selector_scope AS selectorScope, adapter_id AS adapter,
              selector_kind AS selectorKind,
              selector_parameters_json AS selectorParametersJson,
              registry_fingerprint AS registryFingerprint, state,
              started_at_ms AS startedAtMs, checkpoint_at_ms AS checkpointAtMs,
              next_cursor AS nextCursor, last_page_fingerprint AS lastPageFingerprint,
              page_count AS pageCount, partial_page_count AS partialPageCount,
              observed_metadata_count AS observedMetadataCount
       FROM source_metadata_runs
       WHERE source_key = $source AND metadata_run_id = $runId`
    )
    .get({ $source: unbrand(source), $runId: unbrand(runId) }) as RunWireRow | null;
  if (!row) return null;
  return {
    ...row,
    runId: asSourceMetadataRunId(row.runId),
    source: asSourceKey(row.source),
    selectorScope: asSourceScopeId(row.selectorScope),
    adapter: asAdapterId(row.adapter),
    selectorKind: asSelectorKind(row.selectorKind),
    registryFingerprint: asSourceRegistryFingerprint(row.registryFingerprint),
  };
}

function checkpoint(run: RunRow): SourceMetadataRunCheckpoint {
  return {
    runId: run.runId,
    state: run.state,
    ...(run.nextCursor === null ? {} : { nextCursor: run.nextCursor }),
    pageCount: run.pageCount,
    partialPageCount: run.partialPageCount,
    observedMetadataCount: run.observedMetadataCount,
  };
}

function selectorFromRun(run: RunRow): SourceSelector {
  return {
    kind: run.selectorKind,
    scope: run.selectorScope,
    parameters: parseStoredStringRecord(run.selectorParametersJson, 'metadata selector parameters'),
  };
}

function assertRegisteredMetadataRun(
  input: BeginSourceMetadataRunInput,
  registry: SportsSourceRegistry
): void {
  assertSportsSourceRegistry(registry);
  if (input.selector.sport !== undefined) {
    throw new Error('metadata run selector must be source-global');
  }
  const adapter = registry.adapters.find(candidate => candidate.id === input.adapter);
  if (
    !adapter ||
    adapter.source !== input.source ||
    adapter.idNamespace !== 'source_global' ||
    !adapter.metadataDiscovery
  ) {
    throw new Error('metadata run requires a source-global registered adapter');
  }
  if (
    adapter.metadataDiscovery.kind !== input.selector.kind ||
    adapter.metadataDiscovery.scope !== input.selector.scope ||
    adapter.metadataDiscovery.sport !== input.selector.sport ||
    !recordsEqual(adapter.metadataDiscovery.parameters, input.selector.parameters)
  ) {
    throw new Error('metadata run selector is not the exact registered discovery selector');
  }
}

function assertPageMatchesRun(
  page: MetadataPage<NormalizedSourceMetadata>,
  run: RunRow,
  selector: SourceSelector
): void {
  if (
    page.request.metadataRunId !== run.runId ||
    page.request.selector.kind !== selector.kind ||
    page.request.selector.scope !== selector.scope ||
    page.request.selector.sport !== selector.sport ||
    !recordsEqual(page.request.selector.parameters, selector.parameters)
  ) {
    throw new Error('metadata page request does not match source metadata run');
  }
}

function assertMetadataPageMode(
  page: MetadataPage<NormalizedSourceMetadata>,
  run: RunRow,
  registry: SportsSourceRegistry
): void {
  const adapter = registry.adapters.find(candidate => candidate.id === run.adapter);
  if (!adapter?.metadataPageMode) {
    throw new Error('metadata adapter page mode is not registered');
  }
  if (
    adapter.metadataPageMode === 'atomic' &&
    (page.request.pageIndex !== 0 ||
      page.request.cursor !== undefined ||
      page.nextCursor !== undefined ||
      !page.exhausted ||
      page.completeness !== 'complete')
  ) {
    throw new Error('atomic metadata discovery requires one complete terminal page');
  }
}

function assertEntityMatchesRun(entity: NormalizedSourceMetadata, run: RunRow): void {
  if (entity.source !== run.source || entity.metadataKind !== run.selectorKind) {
    throw new Error('metadata entity does not match source metadata run');
  }
}

function pageFingerprint(page: MetadataPage<NormalizedSourceMetadata>): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        request: page.request,
        observedAtMs: page.observedAtMs,
        records: page.records,
        completeness: page.completeness,
        nextCursor: page.nextCursor ?? null,
        exhausted: page.exhausted,
      })
    )
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}
