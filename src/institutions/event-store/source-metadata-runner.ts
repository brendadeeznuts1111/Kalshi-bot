import type { Database } from 'bun:sqlite';
import {
  asSourceMetadataRunId,
  mintSourceMetadataRunId,
  unbrand,
  type AdapterId,
  type SourceKey,
  type SourceMetadataRunId,
  type SportKey,
} from '../market-registry/brands.ts';
import { SPORTS_SOURCE_REGISTRY } from '../market-registry/registry.ts';
import type {
  AdapterDefinition,
  MetadataFetchRequest,
  RuntimeMetadataSourceAdapter,
  SourceSelector,
  SportsSourceRegistry,
} from '../market-registry/types.ts';
import { assertSportsSourceRegistry } from '../market-registry/validate.ts';
import {
  beginSourceMetadataRun,
  abandonSourceMetadataRun,
  commitSourceMetadataPage,
  failSourceMetadataRun,
  type SourceMetadataRunCheckpoint,
} from './source-metadata-run.ts';

type StaleRunWireRow = { runId: string; startedAtMs: number };

export type SourceMetadataTarget = {
  source: SourceKey;
  adapterId: AdapterId;
  adapter: RuntimeMetadataSourceAdapter;
  selector: SourceSelector;
  sports: readonly SportKey[];
};

type SourceMetadataRunResultBase = {
  source: SourceKey;
  adapterId: AdapterId;
  selector: SourceSelector;
  sports: readonly SportKey[];
  pageCount: number;
  observedMetadataCount: number;
};

export type SourceMetadataRunResult = SourceMetadataRunResultBase &
  (
    | { state: 'complete'; runId: SourceMetadataRunId; error?: never }
    | { state: 'failed'; runId?: SourceMetadataRunId; error: string }
  );

export type RunRegisteredSourceMetadataOptions = {
  adapters: readonly RuntimeMetadataSourceAdapter[];
  registry?: SportsSourceRegistry;
  sources?: readonly SourceKey[];
  sports?: readonly SportKey[];
  maxPagesPerSource?: number;
  now?: () => number;
  mintRunId?: (source: SourceKey, selector: SourceSelector) => SourceMetadataRunId;
};

/**
 * Acquire each source-global metadata catalog once, then classify it across all
 * registered sports during atomic terminal publication.
 */
export async function runRegisteredSourceMetadata(
  db: Database,
  options: RunRegisteredSourceMetadataOptions
): Promise<SourceMetadataRunResult[]> {
  const registry = options.registry ?? SPORTS_SOURCE_REGISTRY;
  assertSportsSourceRegistry(registry);
  const maxPages = positiveInteger(options.maxPagesPerSource ?? 100, 'maxPagesPerSource');
  const now = options.now ?? Date.now;
  const mintRunId = options.mintRunId ?? defaultRunId;
  const targets = planRegisteredSourceMetadata(
    registry,
    options.adapters,
    options.sources,
    options.sports
  );
  const results: SourceMetadataRunResult[] = [];

  for (const target of targets) {
    let runId: SourceMetadataRunId | undefined;
    let checkpoint: SourceMetadataRunCheckpoint | undefined;
    let lastObservedAtMs = 0;

    try {
      runId = mintRunId(target.source, target.selector);
      const startedAtMs = timestamp(now(), 'startedAtMs');
      lastObservedAtMs = startedAtMs;
      checkpoint = beginSourceMetadataRun(
        db,
        {
          runId,
          source: target.source,
          adapter: target.adapterId,
          selector: target.selector,
          startedAtMs,
        },
        registry
      );
      while (checkpoint.state === 'running') {
        if (checkpoint.pageCount >= maxPages) {
          throw new Error(`metadata source exceeded ${maxPages} pages`);
        }
        const request: MetadataFetchRequest = {
          selector: target.selector,
          metadataRunId: runId,
          pageIndex: checkpoint.pageCount,
          ...(checkpoint.nextCursor === undefined ? {} : { cursor: checkpoint.nextCursor }),
        };
        const page = await target.adapter.acquirePage(request);
        assertExactPageRequest(page.request, request);
        const observedAtMs = timestamp(page.observedAtMs, 'observedAtMs');
        lastObservedAtMs = Math.max(lastObservedAtMs, observedAtMs);
        checkpoint = commitSourceMetadataPage(db, { source: target.source, page }, registry);
      }
      if (checkpoint.state !== 'complete') {
        throw new Error(`metadata source ended in unexpected state: ${checkpoint.state}`);
      }
      results.push({
        runId,
        source: target.source,
        adapterId: target.adapterId,
        selector: target.selector,
        sports: target.sports,
        state: 'complete',
        pageCount: checkpoint.pageCount,
        observedMetadataCount: checkpoint.observedMetadataCount,
      });
    } catch (cause) {
      let error = errorDetail(cause);
      if (runId && checkpoint?.state === 'running') {
        try {
          failSourceMetadataRun(db, {
            source: target.source,
            runId,
            failedAtMs: Math.max(lastObservedAtMs, timestamp(now(), 'failedAtMs')),
            detail: error,
          });
        } catch (finalizeCause) {
          error = `${error}; failed to finalize owned run: ${errorDetail(finalizeCause)}`;
        }
      }
      results.push({
        ...(runId ? { runId } : {}),
        source: target.source,
        adapterId: target.adapterId,
        selector: target.selector,
        sports: target.sports,
        state: 'failed',
        pageCount: checkpoint?.pageCount ?? 0,
        observedMetadataCount: checkpoint?.observedMetadataCount ?? 0,
        error,
      });
    }
  }

  return results;
}

/** Recover scheduler crashes after one full metadata freshness window. */
export function abandonStaleRegisteredSourceMetadataRuns(
  db: Database,
  nowMs: number,
  targets: readonly SourceMetadataTarget[],
  leaseMs = 5 * 60_000
): number {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('nowMs must be a timestamp');
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
    throw new Error('leaseMs must be a positive integer');
  }
  let abandoned = 0;
  const recover = db.transaction(() => {
    for (const target of targets) {
      const rows = db
        .query(
          `SELECT metadata_run_id AS runId, started_at_ms AS startedAtMs
           FROM source_metadata_runs
           WHERE source_key = $source AND selector_scope = $selectorScope
             AND state = 'running'
             AND COALESCE(checkpoint_at_ms, started_at_ms) <= $staleBeforeMs
           ORDER BY started_at_ms, metadata_run_id`
        )
        .all({
          $source: unbrand(target.source),
          $selectorScope: unbrand(target.selector.scope),
          $staleBeforeMs: nowMs - leaseMs,
        }) as StaleRunWireRow[];
      for (const row of rows) {
        abandonSourceMetadataRun(db, {
          source: target.source,
          runId: asSourceMetadataRunId(row.runId),
          abandonedAtMs: nowMs,
          detail: `scheduler recovery: metadata run lease expired after ${leaseMs}ms`,
        });
        abandoned++;
      }
    }
  });
  recover.immediate();
  return abandoned;
}

export function planRegisteredSourceMetadata(
  registry: SportsSourceRegistry,
  adapters: readonly RuntimeMetadataSourceAdapter[],
  sources?: readonly SourceKey[],
  sports?: readonly SportKey[]
): SourceMetadataTarget[] {
  assertSportsSourceRegistry(registry);
  const runtimeById = new Map<string, RuntimeMetadataSourceAdapter>();
  for (const adapter of adapters) {
    const id = unbrand(adapter.definition.id);
    if (runtimeById.has(id)) throw new Error(`duplicate runtime metadata adapter: ${id}`);
    runtimeById.set(id, adapter);
  }
  const allowedSources = sources ? new Set(sources.map(unbrand)) : undefined;
  const allowedSports = sports ? new Set(sports.map(unbrand)) : undefined;
  assertKnownFilters(registry, allowedSources, allowedSports);

  const targets = registry.adapters.flatMap(definition => {
    const selector = definition.metadataDiscovery;
    if (!selector || (allowedSources && !allowedSources.has(unbrand(definition.source)))) {
      return [];
    }
    const registeredSports = registry.integrations
      .filter(
        registration =>
          registration.adapter === definition.id &&
          registration.source === definition.source &&
          registration.metadataPolicy !== undefined &&
          (registration.state === 'enabled' || registration.state === 'discovering')
      )
      .map(registration => registration.sport)
      .sort((left, right) => unbrand(left).localeCompare(unbrand(right)));
    if (
      registeredSports.length === 0 ||
      (allowedSports && !registeredSports.some(sport => allowedSports.has(unbrand(sport))))
    ) {
      return [];
    }
    const runtime = runtimeById.get(unbrand(definition.id));
    if (!runtime) throw new Error(`runtime metadata adapter missing: ${unbrand(definition.id)}`);
    assertRuntimeDefinition(runtime, definition);
    return [
      {
        source: definition.source,
        adapterId: definition.id,
        adapter: runtime,
        selector,
        sports: registeredSports,
      },
    ];
  });
  const seenSources = new Set<string>();
  for (const target of targets) {
    const source = unbrand(target.source);
    if (seenSources.has(source)) {
      throw new Error(`ambiguous metadata discovery adapters for source: ${source}`);
    }
    seenSources.add(source);
  }
  return targets.sort((left, right) => unbrand(left.source).localeCompare(unbrand(right.source)));
}

function assertRuntimeDefinition(
  runtime: RuntimeMetadataSourceAdapter,
  registered: AdapterDefinition
): void {
  const actual = runtime.definition;
  if (
    actual.id !== registered.id ||
    actual.source !== registered.source ||
    actual.idNamespace !== registered.idNamespace ||
    actual.parserVersion !== registered.parserVersion ||
    actual.metadataPageMode !== registered.metadataPageMode ||
    !stringArraysEqual(actual.selectorKinds, registered.selectorKinds) ||
    !stringArraysEqual(actual.metadataSelectorKinds, registered.metadataSelectorKinds) ||
    !cachePoliciesEqual(actual.cachePolicy, registered.cachePolicy) ||
    !optionalCachePoliciesEqual(actual.metadataCachePolicy, registered.metadataCachePolicy) ||
    !actual.metadataDiscovery ||
    !registered.metadataDiscovery ||
    !selectorsEqual(actual.metadataDiscovery, registered.metadataDiscovery)
  ) {
    throw new Error(`runtime metadata adapter definition drift: ${unbrand(registered.id)}`);
  }
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cachePoliciesEqual(
  left: AdapterDefinition['cachePolicy'],
  right: AdapterDefinition['cachePolicy']
): boolean {
  return (
    left.freshForMs === right.freshForMs &&
    left.staleForMs === right.staleForMs &&
    left.failureThreshold === right.failureThreshold &&
    left.circuitResetMs === right.circuitResetMs
  );
}

function optionalCachePoliciesEqual(
  left: AdapterDefinition['metadataCachePolicy'],
  right: AdapterDefinition['metadataCachePolicy']
): boolean {
  if (!left || !right) return left === right;
  return cachePoliciesEqual(left, right);
}

function assertExactPageRequest(
  actual: MetadataFetchRequest,
  expected: MetadataFetchRequest
): void {
  if (
    !selectorsEqual(actual.selector, expected.selector) ||
    actual.metadataRunId !== expected.metadataRunId ||
    actual.pageIndex !== expected.pageIndex ||
    actual.cursor !== expected.cursor
  ) {
    throw new Error('adapter metadata page request does not match acquisition request');
  }
}

function selectorsEqual(left: SourceSelector, right: SourceSelector): boolean {
  return (
    left.kind === right.kind &&
    left.scope === right.scope &&
    left.sport === right.sport &&
    recordsEqual(left.parameters, right.parameters)
  );
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

function defaultRunId(source: SourceKey, selector: SourceSelector): SourceMetadataRunId {
  return mintSourceMetadataRunId(source, selector.scope);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a timestamp`);
  return value;
}

function errorDetail(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return detail.trim() || 'unknown metadata acquisition failure';
}

function assertKnownFilters(
  registry: SportsSourceRegistry,
  sources: ReadonlySet<string> | undefined,
  sports: ReadonlySet<string> | undefined
): void {
  const knownSources = new Set(registry.sources.map(source => unbrand(source.key)));
  const knownSports = new Set(registry.sports.map(sport => unbrand(sport.key)));
  for (const source of sources ?? []) {
    if (!knownSources.has(source)) throw new Error(`unknown metadata source filter: ${source}`);
  }
  for (const sport of sports ?? []) {
    if (!knownSports.has(sport)) throw new Error(`unknown metadata sport filter: ${sport}`);
  }
}
