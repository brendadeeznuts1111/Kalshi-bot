import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  asAdapterId,
  asSourceKey,
  asSourceInventoryRunId,
  asSourceRegistryFingerprint,
  asSelectorKind,
  asSourceScopeId,
  asSportKey,
  unbrand,
  type AdapterId,
  type SelectorKind,
  type SourceInventoryRunId,
  type SourceKey,
  type SourceRegistryFingerprint,
  type SourceScopeId,
  type SportKey,
} from "../market-registry/brands.ts";
import { registrationFor, SPORTS_SOURCE_REGISTRY } from "../market-registry/registry.ts";
import { sourceRegistryFingerprint } from "../market-registry/fingerprint.ts";
import type {
  NormalizedSourceObservation,
  SourcePage,
  SourceSelector,
  SportsSourceRegistry,
} from "../market-registry/types.ts";
import {
  assertSourceObservationInput,
  upsertSourceObservation,
} from "./source-market-store.ts";

export type SourceInventoryRunState = "running" | "complete" | "failed" | "abandoned";

export type BeginSourceInventoryRunInput = {
  runId: SourceInventoryRunId;
  source: SourceKey;
  sport: SportKey;
  adapter: AdapterId;
  selector: SourceSelector;
  startedAtMs: number;
};

export type CommitSourceInventoryPageInput = {
  source: SourceKey;
  page: SourcePage<NormalizedSourceObservation>;
};

export type SourceInventoryRunCheckpoint = {
  runId: SourceInventoryRunId;
  state: SourceInventoryRunState;
  nextCursor?: string;
  pageCount: number;
  observedEventCount: number;
};

type RunRow = {
  inventoryRunId: SourceInventoryRunId;
  sourceKey: SourceKey;
  sportKey: SportKey;
  selectorScope: SourceScopeId;
  adapterId: AdapterId;
  selectorKind: SelectorKind;
  selectorParametersJson: string;
  registryFingerprint: SourceRegistryFingerprint;
  state: SourceInventoryRunState;
  startedAtMs: number;
  checkpointAtMs: number | null;
  nextCursor: string | null;
  lastRequestCursor: string | null;
  lastPageFingerprint: string | null;
  pageCount: number;
  observedEventCount: number;
};

type RunWireRow = Omit<
  RunRow,
  | "inventoryRunId"
  | "sourceKey"
  | "sportKey"
  | "selectorScope"
  | "adapterId"
  | "selectorKind"
  | "registryFingerprint"
> & {
  inventoryRunId: string; // brand-ok -- parsed immediately after the SQLite boundary
  sourceKey: string; // brand-ok -- parsed immediately after the SQLite boundary
  sportKey: string;
  selectorScope: string;
  adapterId: string; // brand-ok -- parsed immediately after the SQLite boundary
  selectorKind: string;
  registryFingerprint: string;
};

export function beginSourceInventoryRun(
  db: Database,
  input: BeginSourceInventoryRunInput,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SourceInventoryRunCheckpoint {
  assertTimestamp(input.startedAtMs, "startedAtMs");
  assertRegisteredRun(input, registry);
  const registryFingerprint = sourceRegistryFingerprint(registry);
  db.query(
    `INSERT INTO source_inventory_runs (
       source_key, inventory_run_id, sport_key, selector_scope, adapter_id,
       selector_kind, selector_parameters_json, registry_fingerprint,
       state, started_at_ms
     ) VALUES (
       $source, $runId, $sport, $selectorScope, $adapter,
       $selectorKind, $selectorParameters, $registryFingerprint,
       'running', $startedAtMs
     )`,
  ).run({
    $source: unbrand(input.source),
    $runId: unbrand(input.runId),
    $sport: unbrand(input.sport),
    $selectorScope: unbrand(input.selector.scope),
    $adapter: unbrand(input.adapter),
    $selectorKind: unbrand(input.selector.kind),
    $selectorParameters: JSON.stringify(input.selector.parameters),
    $registryFingerprint: unbrand(registryFingerprint),
    $startedAtMs: input.startedAtMs,
  });
  return {
    runId: input.runId,
    state: "running",
    pageCount: 0,
    observedEventCount: 0,
  };
}

export function commitSourceInventoryPage(
  db: Database,
  input: CommitSourceInventoryPageInput,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SourceInventoryRunCheckpoint {
  const { page } = input;
  const runId = page.request.inventoryRunId;
  const pageIndex = page.request.pageIndex;
  if (!runId) throw new Error("inventory page request requires inventoryRunId");
  if (pageIndex === undefined) throw new Error("inventory page request requires pageIndex");
  assertTimestamp(page.observedAtMs, "observedAtMs");
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) {
    throw new Error("pageIndex must be a non-negative safe integer");
  }
  if (page.exhausted !== (page.nextCursor === undefined)) {
    throw new Error("terminal inventory pages must be exhausted and omit nextCursor");
  }
  if (page.nextCursor !== undefined && page.nextCursor.trim().length === 0) {
    throw new Error("nextCursor must be non-empty");
  }
  if (page.nextCursor !== undefined && page.nextCursor === page.request.cursor) {
    throw new Error("inventory page cursor must advance");
  }
  const eventIds = new Set<string>();
  for (const observation of page.records) {
    const eventId = unbrand(observation.eventId);
    if (eventIds.has(eventId)) throw new Error(`duplicate inventory event: ${eventId}`);
    eventIds.add(eventId);
  }
  const fingerprint = pageFingerprint(page);
  const commit = db.transaction((): SourceInventoryRunCheckpoint => {
    const run = readRun(db, input.source, runId);
    if (!run) throw new Error("source inventory run not found");
    const selector = selectorFromRun(run);
    assertRegisteredRun(
      {
        runId,
        source: run.sourceKey,
        sport: run.sportKey,
        adapter: run.adapterId,
        selector,
        startedAtMs: run.startedAtMs,
      },
      registry,
    );
    if (sourceRegistryFingerprint(registry) !== run.registryFingerprint) {
      throw new Error("source inventory registry changed during the run");
    }
    assertSelectorMatches(page.request.selector, selector, "inventory page request");
    for (const observation of page.records) {
      assertObservationMatchesRun(observation, run, selector, page.observedAtMs);
      assertSourceObservationInput(observation, registry);
    }
    if (
      (run.state === "running" || run.state === "complete") &&
      run.lastPageFingerprint === fingerprint &&
      pageIndex === run.pageCount - 1
    ) {
      return checkpoint(run);
    }
    if (run.state !== "running") throw new Error(`source inventory run is ${run.state}`);
    if (page.observedAtMs < run.startedAtMs) {
      throw new Error("page observedAtMs precedes run start");
    }
    if (run.checkpointAtMs !== null && page.observedAtMs < run.checkpointAtMs) {
      throw new Error("page observedAtMs precedes the prior checkpoint");
    }
    if (pageIndex !== run.pageCount) throw new Error("inventory page index is out of order");
    if ((page.request.cursor ?? null) !== run.nextCursor) {
      throw new Error("inventory request cursor does not match checkpoint");
    }

    for (const observation of page.records) {
      upsertSourceObservation(
        db,
        {
          ...observation,
          provenance: {
            ...observation.provenance,
            inventoryRunId: runId,
          },
        },
        registry,
      );
    }

    db.query(
      `INSERT INTO source_inventory_run_pages (
         source_key, inventory_run_id, page_index, request_cursor, next_cursor,
         observed_at_ms, event_count, exhausted, page_fingerprint
       ) VALUES (
         $source, $runId, $pageIndex, $requestCursor, $nextCursor,
         $observedAtMs, $eventCount, $exhausted, $fingerprint
       )`,
    ).run({
      $source: run.sourceKey,
      $runId: run.inventoryRunId,
      $pageIndex: pageIndex,
      $requestCursor: page.request.cursor ?? null,
      $nextCursor: page.nextCursor ?? null,
      $observedAtMs: page.observedAtMs,
      $eventCount: page.records.length,
      $exhausted: page.exhausted ? 1 : 0,
      $fingerprint: fingerprint,
    });

    const nextState: SourceInventoryRunState = page.exhausted ? "complete" : "running";
    db.query(
      `UPDATE source_inventory_runs
       SET state = $state,
           checkpoint_at_ms = $observedAtMs,
           finished_at_ms = CASE WHEN $exhausted = 1 THEN $observedAtMs ELSE NULL END,
           next_cursor = $nextCursor,
           last_request_cursor = $requestCursor,
           last_page_fingerprint = $fingerprint,
           page_count = page_count + 1,
           observed_event_count = observed_event_count + $eventCount,
           exhausted = $exhausted
       WHERE source_key = $source AND inventory_run_id = $runId AND state = 'running'`,
    ).run({
      $state: nextState,
      $observedAtMs: page.observedAtMs,
      $exhausted: page.exhausted ? 1 : 0,
      $nextCursor: page.nextCursor ?? null,
      $requestCursor: page.request.cursor ?? null,
      $fingerprint: fingerprint,
      $eventCount: page.records.length,
      $source: run.sourceKey,
      $runId: run.inventoryRunId,
    });

    if (page.exhausted) {
      db.query(
        `UPDATE source_event_selectors
         SET active = 0, retired_at_ms = $observedAtMs
         WHERE source_key = $source
           AND selector_scope = $selectorScope
           AND active = 1
           AND last_observed_at_ms < $observedAtMs
           AND (last_seen_run_id IS NULL OR last_seen_run_id <> $runId)`,
      ).run({
        $observedAtMs: page.observedAtMs,
        $source: run.sourceKey,
        $selectorScope: run.selectorScope,
        $runId: run.inventoryRunId,
      });
    }
    const updated = readRun(db, input.source, runId);
    if (!updated) throw new Error("source inventory run disappeared during commit");
    return checkpoint(updated);
  });
  return commit.immediate();
}

export function failSourceInventoryRun(
  db: Database,
  input: {
    source: SourceKey;
    runId: SourceInventoryRunId;
    failedAtMs: number;
    detail: string;
  },
): void {
  finishWithoutRetirement(db, input.source, input.runId, "failed", input.failedAtMs, input.detail);
}

export function abandonSourceInventoryRun(
  db: Database,
  input: {
    source: SourceKey;
    runId: SourceInventoryRunId;
    abandonedAtMs: number;
    detail: string;
  },
): void {
  finishWithoutRetirement(
    db,
    input.source,
    input.runId,
    "abandoned",
    input.abandonedAtMs,
    input.detail,
  );
}

export function resumeSourceInventoryRun(
  db: Database,
  source: SourceKey,
  runId: SourceInventoryRunId,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY,
): SourceInventoryRunCheckpoint {
  const run = readRun(db, source, runId);
  if (!run) throw new Error("source inventory run not found");
  if (run.state !== "running") throw new Error(`source inventory run is ${run.state}`);
  if (sourceRegistryFingerprint(registry) !== run.registryFingerprint) {
    throw new Error("source inventory registry changed during the run");
  }
  return checkpoint(run);
}

function finishWithoutRetirement(
  db: Database,
  source: SourceKey,
  runId: SourceInventoryRunId,
  state: "failed" | "abandoned",
  finishedAtMs: number,
  detail: string,
): void {
  assertTimestamp(finishedAtMs, "finishedAtMs");
  const result = db
    .query(
      `UPDATE source_inventory_runs
     SET state = $state, finished_at_ms = $finishedAtMs, error_detail = $detail
     WHERE source_key = $source AND inventory_run_id = $runId
       AND state = 'running' AND started_at_ms <= $finishedAtMs
       AND (checkpoint_at_ms IS NULL OR checkpoint_at_ms <= $finishedAtMs)`,
    )
    .run({
      $state: state,
      $finishedAtMs: finishedAtMs,
      $detail: detail,
      $source: unbrand(source),
      $runId: unbrand(runId),
    });
  if (result.changes !== 1) throw new Error("running source inventory run not found");
}

function readRun(db: Database, source: SourceKey, runId: SourceInventoryRunId): RunRow | null {
  const row = db
    .query(
      `SELECT inventory_run_id AS inventoryRunId, source_key AS sourceKey,
            sport_key AS sportKey, selector_scope AS selectorScope,
            adapter_id AS adapterId, selector_kind AS selectorKind,
            selector_parameters_json AS selectorParametersJson,
            registry_fingerprint AS registryFingerprint, state,
            started_at_ms AS startedAtMs, checkpoint_at_ms AS checkpointAtMs,
            next_cursor AS nextCursor,
            last_request_cursor AS lastRequestCursor,
            last_page_fingerprint AS lastPageFingerprint,
            page_count AS pageCount, observed_event_count AS observedEventCount
     FROM source_inventory_runs
     WHERE source_key = $source AND inventory_run_id = $runId`,
    )
    .get({ $source: unbrand(source), $runId: unbrand(runId) }) as RunWireRow | null;
  if (!row) return null;
  return {
    ...row,
    inventoryRunId: asSourceInventoryRunId(row.inventoryRunId),
    sourceKey: asSourceKey(row.sourceKey),
    sportKey: asSportKey(row.sportKey),
    selectorScope: asSourceScopeId(row.selectorScope),
    adapterId: asAdapterId(row.adapterId),
    selectorKind: asSelectorKind(row.selectorKind),
    registryFingerprint: asSourceRegistryFingerprint(row.registryFingerprint),
  };
}

function checkpoint(run: RunRow): SourceInventoryRunCheckpoint {
  return {
    runId: run.inventoryRunId,
    state: run.state,
    ...(run.nextCursor === null ? {} : { nextCursor: run.nextCursor }),
    pageCount: run.pageCount,
    observedEventCount: run.observedEventCount,
  };
}

function selectorFromRun(run: RunRow): SourceSelector {
  return {
    kind: run.selectorKind,
    scope: run.selectorScope,
    sport: run.sportKey,
    parameters: JSON.parse(run.selectorParametersJson) as Record<string, string>,
  };
}

function assertRegisteredRun(
  input: BeginSourceInventoryRunInput,
  registry: SportsSourceRegistry,
): void {
  if (input.selector.sport !== input.sport) throw new Error("run selector sport mismatch");
  const registration = registrationFor(input.source, input.sport, registry);
  if (!registration || registration.adapter !== input.adapter) {
    throw new Error("run source/sport/adapter is not registered");
  }
  if (
    (registration.state !== "enabled" && registration.state !== "discovering") ||
    !registration.operationalCapabilities.includes("inventory")
  ) {
    throw new Error("source/sport integration is not operational for inventory");
  }
  const adapter = registry.adapters.find((candidate) => candidate.id === input.adapter);
  if (!adapter || adapter.source !== input.source || adapter.idNamespace !== "source_global") {
    throw new Error("inventory run requires a source-global registered adapter");
  }
  const binding = registration.competitions.find(
    (candidate) => candidate.selector.scope === input.selector.scope,
  );
  if (
    !binding ||
    binding.selector.kind !== input.selector.kind ||
    binding.selector.sport !== input.selector.sport ||
    !recordsEqual(binding.selector.parameters, input.selector.parameters)
  ) {
    throw new Error("inventory run selector is not an exact registered binding");
  }
}

function assertObservationMatchesRun(
  observation: NormalizedSourceObservation,
  run: RunRow,
  selector: SourceSelector,
  observedAtMs: number,
): void {
  if (
    unbrand(observation.source) !== run.sourceKey ||
    unbrand(observation.sport) !== run.sportKey ||
    unbrand(observation.provenance.adapter) !== run.adapterId ||
    observation.provenance.selector.kind !== selector.kind ||
    observation.provenance.selector.scope !== selector.scope ||
    observation.provenance.selector.sport !== selector.sport ||
    !recordsEqual(observation.provenance.selector.parameters, selector.parameters) ||
    (observation.provenance.inventoryRunId !== undefined &&
      unbrand(observation.provenance.inventoryRunId) !== run.inventoryRunId) ||
    observation.provenance.observedAtMs !== observedAtMs
  ) {
    throw new Error("source observation does not match inventory run page");
  }
}

function assertSelectorMatches(
  actual: SourceSelector,
  expected: SourceSelector,
  label: string,
): void {
  if (
    actual.kind !== expected.kind ||
    actual.scope !== expected.scope ||
    actual.sport !== expected.sport ||
    !recordsEqual(actual.parameters, expected.parameters)
  ) {
    throw new Error(`${label} selector does not match inventory run`);
  }
}

function pageFingerprint(page: SourcePage<NormalizedSourceObservation>): string {
  const records = page.records.map((observation) => {
    const { inventoryRunId: _inventoryRunId, ...provenance } = observation.provenance;
    return { ...observation, provenance };
  });
  const canonical = canonicalJson({
    request: page.request,
    observedAtMs: page.observedAtMs,
    records,
    nextCursor: page.nextCursor ?? null,
    exhausted: page.exhausted,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function recordsEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
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
