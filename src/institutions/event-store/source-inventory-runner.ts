import type { Database } from 'bun:sqlite';
import {
  mintSourceInventoryRunId,
  unbrand,
  type IntegrationId,
  type SourceInventoryRunId,
  type SourceKey,
  type SportKey,
} from '../market-registry/brands.ts';
import { SPORTS_SOURCE_REGISTRY } from '../market-registry/registry.ts';
import { assertSportsSourceRegistry } from '../market-registry/validate.ts';
import type {
  CompetitionBinding,
  InventorySourceAdapter,
  SourceFetchRequest,
  SourcePage,
  SportsSourceRegistry,
} from '../market-registry/types.ts';
import {
  beginSourceInventoryRun,
  commitSourceInventoryPage,
  failSourceInventoryRun,
  type SourceInventoryRunCheckpoint,
} from './source-inventory-run.ts';

export type SourceInventoryScopeResult = {
  runId: SourceInventoryRunId;
  integration: IntegrationId;
  source: SourceKey;
  sport: SportKey;
  binding: CompetitionBinding;
  state: 'complete' | 'failed';
  pageCount: number;
  observedEventCount: number;
  error?: string;
};

export type RunRegisteredSourceInventoryOptions = {
  adapters: readonly InventorySourceAdapter[];
  registry?: SportsSourceRegistry;
  sports?: readonly SportKey[];
  sources?: readonly SourceKey[];
  pageSize?: number;
  maxPagesPerScope?: number;
  now?: () => number;
  mintRunId?: (
    source: SourceKey,
    sport: SportKey,
    binding: CompetitionBinding
  ) => SourceInventoryRunId;
};

export type SourceInventoryTarget = {
  integration: IntegrationId;
  source: SourceKey;
  sport: SportKey;
  adapter: InventorySourceAdapter;
  binding: CompetitionBinding;
};

/**
 * Walk every operational inventory selector in the registry. A failed scope is
 * recorded and isolated so one venue or competition cannot hide coverage from
 * the remaining registry.
 */
export async function runRegisteredSourceInventory(
  db: Database,
  options: RunRegisteredSourceInventoryOptions
): Promise<SourceInventoryScopeResult[]> {
  const registry = options.registry ?? SPORTS_SOURCE_REGISTRY;
  assertSportsSourceRegistry(registry);
  const pageSize = positiveInteger(options.pageSize ?? 200, 'pageSize');
  const maxPages = positiveInteger(options.maxPagesPerScope ?? 1_000, 'maxPagesPerScope');
  const now = options.now ?? Date.now;
  const mintRunId = options.mintRunId ?? defaultRunId;
  const targets = planRegisteredSourceInventory(
    registry,
    options.adapters,
    options.sports,
    options.sources
  );
  const results: SourceInventoryScopeResult[] = [];

  for (const target of targets) {
    const runId = mintRunId(target.source, target.sport, target.binding);
    const startedAtMs = timestamp(now(), 'startedAtMs');
    let checkpoint: SourceInventoryRunCheckpoint | undefined;
    let lastObservedAtMs = startedAtMs;

    try {
      checkpoint = beginSourceInventoryRun(
        db,
        {
          runId,
          source: target.source,
          sport: target.sport,
          adapter: target.adapter.definition.id,
          selector: target.binding.selector,
          startedAtMs,
        },
        registry
      );
      while (checkpoint.state === 'running') {
        if (checkpoint.pageCount >= maxPages) {
          throw new Error(`inventory scope exceeded ${maxPages} pages`);
        }
        const request: SourceFetchRequest = {
          selector: target.binding.selector,
          inventoryRunId: runId,
          pageIndex: checkpoint.pageCount,
          ...(checkpoint.nextCursor === undefined ? {} : { cursor: checkpoint.nextCursor }),
          limit: pageSize,
        };
        const page = await target.adapter.acquirePage(request, target.binding);
        assertExactPageRequest(page, request);
        lastObservedAtMs = Math.max(lastObservedAtMs, page.observedAtMs);
        checkpoint = commitSourceInventoryPage(db, { source: target.source, page }, registry);
      }
      results.push(scopeResult(target, checkpoint));
    } catch (cause) {
      let error = errorDetail(cause);
      if (checkpoint?.state === 'running') {
        try {
          failSourceInventoryRun(db, {
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
        runId,
        integration: target.integration,
        source: target.source,
        sport: target.sport,
        binding: target.binding,
        state: 'failed',
        pageCount: checkpoint?.pageCount ?? 0,
        observedEventCount: checkpoint?.observedEventCount ?? 0,
        error,
      });
    }
  }

  return results;
}

export function planRegisteredSourceInventory(
  registry: SportsSourceRegistry,
  adapters: readonly InventorySourceAdapter[],
  sports?: readonly SportKey[],
  sources?: readonly SourceKey[]
): SourceInventoryTarget[] {
  const adapterById = new Map<string, InventorySourceAdapter>();
  for (const adapter of adapters) {
    const id = unbrand(adapter.definition.id);
    if (adapterById.has(id)) throw new Error(`duplicate runtime adapter: ${id}`);
    adapterById.set(id, adapter);
  }
  const allowedSports = sports ? new Set(sports.map(unbrand)) : undefined;
  const allowedSources = sources ? new Set(sources.map(unbrand)) : undefined;

  return registry.integrations
    .flatMap(registration => {
      if (
        (registration.state !== 'enabled' && registration.state !== 'discovering') ||
        !registration.operationalCapabilities.includes('inventory') ||
        (allowedSports && !allowedSports.has(unbrand(registration.sport))) ||
        (allowedSources && !allowedSources.has(unbrand(registration.source)))
      ) {
        return [];
      }
      const adapter = adapterById.get(unbrand(registration.adapter));
      if (!adapter) {
        throw new Error(`runtime adapter missing: ${unbrand(registration.adapter)}`);
      }
      if (
        adapter.definition.id !== registration.adapter ||
        adapter.definition.source !== registration.source
      ) {
        throw new Error(`runtime adapter definition drift: ${unbrand(registration.adapter)}`);
      }
      return registration.competitions.map(binding => ({
        integration: registration.integration,
        source: registration.source,
        sport: registration.sport,
        adapter,
        binding,
      }));
    })
    .sort((left, right) =>
      `${unbrand(left.integration)}:${unbrand(left.binding.selector.scope)}`.localeCompare(
        `${unbrand(right.integration)}:${unbrand(right.binding.selector.scope)}`
      )
    );
}

function assertExactPageRequest(page: SourcePage<object>, request: SourceFetchRequest): void {
  if (
    page.request.selector.kind !== request.selector.kind ||
    page.request.selector.scope !== request.selector.scope ||
    page.request.selector.sport !== request.selector.sport ||
    !recordsEqual(page.request.selector.parameters, request.selector.parameters) ||
    page.request.inventoryRunId !== request.inventoryRunId ||
    page.request.pageIndex !== request.pageIndex ||
    page.request.cursor !== request.cursor ||
    page.request.limit !== request.limit
  ) {
    throw new Error('adapter page request does not match inventory request');
  }
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

function scopeResult(
  target: SourceInventoryTarget,
  checkpoint: SourceInventoryRunCheckpoint
): SourceInventoryScopeResult {
  if (checkpoint.state !== 'complete') {
    throw new Error(`inventory scope ended in unexpected state: ${checkpoint.state}`);
  }
  return {
    runId: checkpoint.runId,
    integration: target.integration,
    source: target.source,
    sport: target.sport,
    binding: target.binding,
    state: 'complete',
    pageCount: checkpoint.pageCount,
    observedEventCount: checkpoint.observedEventCount,
  };
}

function defaultRunId(
  source: SourceKey,
  sport: SportKey,
  binding: CompetitionBinding
): SourceInventoryRunId {
  return mintSourceInventoryRunId(source, sport, binding.selector.scope);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`);
  return value;
}

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a timestamp`);
  return value;
}

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
