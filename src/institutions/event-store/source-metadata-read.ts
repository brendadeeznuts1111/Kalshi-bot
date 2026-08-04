import type { Database } from 'bun:sqlite';
import { unbrand } from '../market-registry/brands.ts';
import { SPORTS_SOURCE_REGISTRY } from '../market-registry/registry.ts';
import type { SportsSourceRegistry } from '../market-registry/types.ts';
import { assertSportsSourceRegistry } from '../market-registry/validate.ts';
import { sourceRegistryFingerprint } from './source-metadata-store.ts';

export type SourceMetadataDiscoveryRecord = {
  metadataKind: string;
  metadataId: string; // brand-ok -- public registry artifact boundary
  label: string;
  sourceUpdatedAtMs?: number;
  reasonCode: string;
  matchedSelectorScope?: string;
};

type SourceMetadataRunState = 'running' | 'complete' | 'failed' | 'abandoned';

export type SourceMetadataDiscoveryCell = {
  integration: string;
  sport: string;
  sportLabel: string;
  source: string;
  sourceLabel: string;
  integrationState: string;
  adapter: string;
  discovery: {
    scope: string;
    kind: string;
    pageMode: 'atomic' | 'cursor';
  } | null;
  latestRun:
    | { state: 'never_run' }
    | {
        runId: string; // brand-ok -- public registry artifact boundary
        state: SourceMetadataRunState;
        startedAtMs: number;
        checkpointAtMs: number | null;
        finishedAtMs: number | null;
        pageCount: number;
        observedMetadataCount: number;
        registryFingerprint: string;
        error: string | null;
        attemptSequence: number | null;
      };
  snapshot: {
    runId?: string; // brand-ok -- public registry artifact boundary
    observedAtMs?: number;
    ageMs?: number;
    futureByMs?: number;
    freshForMs?: number;
    staleForMs?: number;
    servingStale: boolean;
    servingExpired: boolean;
    runFingerprintState: 'unobserved' | 'current' | 'stale';
    classificationFingerprintState: 'unobserved' | 'current' | 'stale' | 'mixed';
  };
  counts: {
    registered: number;
    quarantined: number;
    ignored: number;
  };
  registered: SourceMetadataDiscoveryRecord[];
  quarantined: SourceMetadataDiscoveryRecord[];
};

export type SportsSourceDiscoveryArtifact = {
  schema: 'sports-source-discovery/v1';
  generatedAt: string;
  registryFingerprint: string;
  cells: SourceMetadataDiscoveryCell[];
};

type RunWireRow = {
  source: string;
  adapterId: string; // brand-ok -- public registry artifact boundary
  selectorScope: string;
  runId: string; // brand-ok -- parsed as an artifact boundary value
  attemptSequence: number | null;
  state: SourceMetadataRunState;
  startedAtMs: number;
  checkpointAtMs: number | null;
  finishedAtMs: number | null;
  pageCount: number;
  observedMetadataCount: number;
  registryFingerprint: string;
  error: string | null;
};

type ClassificationWireRow = {
  source: string;
  adapterId: string; // brand-ok -- public registry artifact boundary
  selectorScope: string;
  sport: string;
  metadataKind: string;
  metadataId: string; // brand-ok -- parsed as an artifact boundary value
  label: string;
  sourceUpdatedAtMs: number | null;
  disposition: 'registered' | 'quarantined' | 'ignored';
  reasonCode: string;
  matchedSelectorScope: string | null;
  registryFingerprint: string;
};

type ClassificationCountWireRow = {
  source: string;
  adapterId: string; // brand-ok -- public registry artifact boundary
  selectorScope: string;
  sport: string;
  disposition: 'registered' | 'quarantined' | 'ignored';
  count: number;
};

type ClassificationFingerprintWireRow = {
  source: string;
  adapterId: string; // brand-ok -- public registry artifact boundary
  selectorScope: string;
  sport: string;
  registryFingerprint: string;
};

type RunBoundaryRow = Omit<RunWireRow, 'state'> & { state: string };

/** Build the stable sport-first consumer view without exposing ignored-record bulk. */
export function buildSportsSourceDiscoveryArtifact(
  db: Database,
  generatedAt: string,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY
): SportsSourceDiscoveryArtifact {
  assertIsoTimestamp(generatedAt);
  assertSportsSourceRegistry(registry);
  const read = db.transaction(() =>
    buildSportsSourceDiscoverySnapshot(db, generatedAt, registry)
  );
  return read();
}

function buildSportsSourceDiscoverySnapshot(
  db: Database,
  generatedAt: string,
  registry: SportsSourceRegistry
): SportsSourceDiscoveryArtifact {
  const generatedAtMs = Date.parse(generatedAt);
  const fingerprint = unbrand(sourceRegistryFingerprint(registry));
  const runRows = runs(db);
  const latestRunByAuthority = firstRunByAuthority(runRows);
  const servingRunByAuthority = firstRunByAuthority(runRows.filter(run => run.state === 'complete'));
  const classifications = activeClassificationDetails(db);
  const classificationByCell = new Map<string, ClassificationWireRow[]>();
  for (const row of classifications) {
    const key = cellKey(row.source, row.adapterId, row.selectorScope, row.sport);
    const rows = classificationByCell.get(key) ?? [];
    rows.push(row);
    classificationByCell.set(key, rows);
  }
  const countByCellDisposition = new Map<string, number>();
  for (const row of activeClassificationCounts(db)) {
    countByCellDisposition.set(
      dispositionKey(row.source, row.adapterId, row.selectorScope, row.sport, row.disposition),
      row.count
    );
  }
  const fingerprintsByCell = new Map<string, Set<string>>();
  for (const row of activeClassificationFingerprints(db)) {
    const key = cellKey(row.source, row.adapterId, row.selectorScope, row.sport);
    const fingerprints = fingerprintsByCell.get(key) ?? new Set<string>();
    fingerprints.add(row.registryFingerprint);
    fingerprintsByCell.set(key, fingerprints);
  }
  const sportLabels = new Map(registry.sports.map(sport => [unbrand(sport.key), sport.label]));
  const sourceLabels = new Map(registry.sources.map(source => [unbrand(source.key), source.label]));
  const adapterById = new Map(registry.adapters.map(adapter => [unbrand(adapter.id), adapter]));
  const sportOrder = new Map(registry.sports.map((sport, index) => [unbrand(sport.key), index]));
  const sourceOrder = new Map(
    registry.sources.map((source, index) => [unbrand(source.key), index])
  );

  const cells = registry.integrations
    .map(registration => {
      const source = unbrand(registration.source);
      const sport = unbrand(registration.sport);
      const adapter = adapterById.get(unbrand(registration.adapter));
      const selectorScope = adapter?.metadataDiscovery
        ? unbrand(adapter.metadataDiscovery.scope)
        : undefined;
      const authority =
        adapter && selectorScope
          ? authorityKey(source, unbrand(adapter.id), selectorScope)
          : undefined;
      const key =
        adapter && selectorScope
          ? cellKey(source, unbrand(adapter.id), selectorScope, sport)
          : undefined;
      const rows = key ? (classificationByCell.get(key) ?? []) : [];
      const registered = recordsFor(rows, 'registered');
      const quarantined = recordsFor(rows, 'quarantined');
      const latestRun = authority ? latestRunByAuthority.get(authority) : undefined;
      const servingRun = authority ? servingRunByAuthority.get(authority) : undefined;
      const runFingerprintState = runRegistryState(servingRun, fingerprint);
      const classificationFingerprintState = classificationRegistryState(
        key ? fingerprintsByCell.get(key) : undefined,
        servingRun,
        fingerprint
      );
      const servingObservedAtMs = servingRun?.checkpointAtMs ?? servingRun?.startedAtMs;
      const freshForMs = adapter?.metadataCachePolicy?.freshForMs;
      const staleForMs = adapter?.metadataCachePolicy?.staleForMs;
      const rawAgeMs =
        servingObservedAtMs === undefined ? undefined : generatedAtMs - servingObservedAtMs;
      const ageMs = rawAgeMs === undefined ? undefined : Math.max(0, rawAgeMs);
      const futureByMs = rawAgeMs !== undefined && rawAgeMs < 0 ? -rawAgeMs : undefined;
      const stale = ageMs !== undefined && freshForMs !== undefined && ageMs >= freshForMs;
      const expired = ageMs !== undefined && staleForMs !== undefined && ageMs >= staleForMs;
      return {
        integration: unbrand(registration.integration),
        sport,
        sportLabel: requiredLabel(sportLabels.get(sport), sport),
        source,
        sourceLabel: requiredLabel(sourceLabels.get(source), source),
        integrationState: registration.state,
        adapter: unbrand(registration.adapter),
        discovery:
          adapter?.metadataDiscovery && adapter.metadataPageMode
            ? {
                scope: unbrand(adapter.metadataDiscovery.scope),
                kind: unbrand(adapter.metadataDiscovery.kind),
                pageMode: adapter.metadataPageMode,
              }
            : null,
        latestRun: latestRun ? publicRun(latestRun) : { state: 'never_run' },
        snapshot: {
          ...(servingRun
            ? {
                runId: servingRun.runId,
                observedAtMs: servingObservedAtMs,
                ageMs,
                ...(futureByMs === undefined ? {} : { futureByMs }),
                ...(freshForMs === undefined ? {} : { freshForMs }),
                ...(staleForMs === undefined ? {} : { staleForMs }),
              }
            : {}),
          servingStale:
            servingRun !== undefined &&
            (latestRun?.runId !== servingRun.runId ||
              runFingerprintState !== 'current' ||
              classificationFingerprintState !== 'current' ||
              stale ||
              futureByMs !== undefined),
          servingExpired: servingRun !== undefined && expired,
          runFingerprintState,
          classificationFingerprintState,
        },
        counts: {
          registered: countFor(countByCellDisposition, key, 'registered'),
          quarantined: countFor(countByCellDisposition, key, 'quarantined'),
          ignored: countFor(countByCellDisposition, key, 'ignored'),
        },
        registered,
        quarantined,
      } satisfies SourceMetadataDiscoveryCell;
    })
    .sort((left, right) => {
      const sportDelta =
        requiredOrder(sportOrder.get(left.sport), left.sport) -
        requiredOrder(sportOrder.get(right.sport), right.sport);
      if (sportDelta !== 0) return sportDelta;
      return (
        requiredOrder(sourceOrder.get(left.source), left.source) -
        requiredOrder(sourceOrder.get(right.source), right.source)
      );
    });

  return {
    schema: 'sports-source-discovery/v1',
    generatedAt,
    registryFingerprint: fingerprint,
    cells,
  };
}

function runs(db: Database): RunWireRow[] {
  const rows = db
    .query(
      `SELECT run.source_key AS source, run.adapter_id AS adapterId,
              run.selector_scope AS selectorScope, run.metadata_run_id AS runId,
              attempt.attempt_sequence AS attemptSequence, run.state,
              run.started_at_ms AS startedAtMs, run.checkpoint_at_ms AS checkpointAtMs,
              run.finished_at_ms AS finishedAtMs, run.page_count AS pageCount,
              run.observed_metadata_count AS observedMetadataCount,
              run.registry_fingerprint AS registryFingerprint, run.error_detail AS error
       FROM source_metadata_runs AS run
       LEFT JOIN source_metadata_run_attempts AS attempt
         ON attempt.source_key = run.source_key
        AND attempt.metadata_run_id = run.metadata_run_id
       ORDER BY run.source_key, run.adapter_id, run.selector_scope,
                CASE WHEN attempt.attempt_sequence IS NULL THEN 0 ELSE 1 END DESC,
                attempt.attempt_sequence DESC,
                COALESCE(run.finished_at_ms, run.checkpoint_at_ms, run.started_at_ms) DESC,
                run.metadata_run_id DESC`
    )
    .all() as RunBoundaryRow[];
  return rows.map(row => ({ ...row, state: parseRunState(row.state) }));
}

function firstRunByAuthority(rows: readonly RunWireRow[]): Map<string, RunWireRow> {
  const result = new Map<string, RunWireRow>();
  for (const row of rows) {
    const key = authorityKey(row.source, row.adapterId, row.selectorScope);
    if (result.has(key)) continue;
    result.set(key, row);
  }
  return result;
}

function publicRun(
  row: RunWireRow
): Exclude<SourceMetadataDiscoveryCell['latestRun'], { state: 'never_run' }> {
  const { source: _source, adapterId: _adapterId, selectorScope: _selectorScope, ...run } = row;
  return run;
}

function activeClassificationDetails(db: Database): ClassificationWireRow[] {
  return db
    .query(
      `SELECT classification.source_key AS source,
              entity.adapter_id AS adapterId, entity.selector_scope AS selectorScope,
              classification.sport_key AS sport,
              classification.metadata_kind AS metadataKind,
              classification.metadata_id AS metadataId,
              entity.label, entity.source_updated_at_ms AS sourceUpdatedAtMs,
              classification.disposition,
              classification.reason_code AS reasonCode,
              classification.matched_selector_scope AS matchedSelectorScope,
              classification.registry_fingerprint AS registryFingerprint
       FROM active_source_metadata_classifications AS classification
       JOIN source_metadata_entities AS entity
         ON entity.source_key = classification.source_key
        AND entity.metadata_kind = classification.metadata_kind
        AND entity.metadata_id = classification.metadata_id
       WHERE classification.disposition IN ('registered', 'quarantined')
       ORDER BY classification.source_key, classification.sport_key,
                classification.disposition, classification.metadata_kind,
                classification.metadata_id`
    )
    .all() as ClassificationWireRow[];
}

function activeClassificationCounts(db: Database): ClassificationCountWireRow[] {
  return db
    .query(
      `SELECT classification.source_key AS source,
              entity.adapter_id AS adapterId, entity.selector_scope AS selectorScope,
              classification.sport_key AS sport, classification.disposition,
              COUNT(*) AS count
       FROM active_source_metadata_classifications AS classification
       JOIN source_metadata_entities AS entity
         ON entity.source_key = classification.source_key
        AND entity.metadata_kind = classification.metadata_kind
        AND entity.metadata_id = classification.metadata_id
       GROUP BY classification.source_key, entity.adapter_id, entity.selector_scope,
                classification.sport_key, classification.disposition
       ORDER BY classification.source_key, entity.adapter_id, entity.selector_scope,
                classification.sport_key, classification.disposition`
    )
    .all() as ClassificationCountWireRow[];
}

function activeClassificationFingerprints(db: Database): ClassificationFingerprintWireRow[] {
  return db
    .query(
      `SELECT classification.source_key AS source,
              entity.adapter_id AS adapterId, entity.selector_scope AS selectorScope,
              classification.sport_key AS sport,
              classification.registry_fingerprint AS registryFingerprint
       FROM active_source_metadata_classifications AS classification
       JOIN source_metadata_entities AS entity
         ON entity.source_key = classification.source_key
        AND entity.metadata_kind = classification.metadata_kind
        AND entity.metadata_id = classification.metadata_id
       GROUP BY classification.source_key, entity.adapter_id, entity.selector_scope,
                classification.sport_key, classification.registry_fingerprint
       ORDER BY classification.source_key, entity.adapter_id, entity.selector_scope,
                classification.sport_key, classification.registry_fingerprint`
    )
    .all() as ClassificationFingerprintWireRow[];
}

function recordsFor(
  rows: readonly ClassificationWireRow[],
  disposition: 'registered' | 'quarantined'
): SourceMetadataDiscoveryRecord[] {
  return rows
    .filter(row => row.disposition === disposition)
    .map(row => ({
      metadataKind: row.metadataKind,
      metadataId: row.metadataId,
      label: row.label,
      ...(row.sourceUpdatedAtMs === null ? {} : { sourceUpdatedAtMs: row.sourceUpdatedAtMs }),
      reasonCode: row.reasonCode,
      ...(row.matchedSelectorScope === null
        ? {}
        : { matchedSelectorScope: row.matchedSelectorScope }),
    }));
}

function runRegistryState(
  servingRun: RunWireRow | undefined,
  currentFingerprint: string
): SourceMetadataDiscoveryCell['snapshot']['runFingerprintState'] {
  if (!servingRun) return 'unobserved';
  return servingRun.registryFingerprint === currentFingerprint ? 'current' : 'stale';
}

function classificationRegistryState(
  fingerprints: ReadonlySet<string> | undefined,
  servingRun: RunWireRow | undefined,
  currentFingerprint: string
): SourceMetadataDiscoveryCell['snapshot']['classificationFingerprintState'] {
  if (!servingRun || !fingerprints?.size) return 'unobserved';
  if (fingerprints.size > 1) return 'mixed';
  return fingerprints.has(currentFingerprint) ? 'current' : 'stale';
}

function authorityKey(source: string, adapterId: string, selectorScope: string): string {
  return `${source}\u0000${adapterId}\u0000${selectorScope}`;
}

function cellKey(source: string, adapterId: string, selectorScope: string, sport: string): string {
  return `${authorityKey(source, adapterId, selectorScope)}\u0000${sport}`;
}

function dispositionKey(
  source: string,
  adapterId: string,
  selectorScope: string,
  sport: string,
  disposition: ClassificationCountWireRow['disposition']
): string {
  return `${cellKey(source, adapterId, selectorScope, sport)}\u0000${disposition}`;
}

function countFor(
  counts: ReadonlyMap<string, number>,
  key: string | undefined,
  disposition: ClassificationCountWireRow['disposition']
): number {
  return key ? (counts.get(`${key}\u0000${disposition}`) ?? 0) : 0;
}

function requiredLabel(value: string | undefined, key: string): string {
  if (!value) throw new Error(`registry label missing: ${key}`);
  return value;
}

function requiredOrder(value: number | undefined, key: string): number {
  if (value === undefined) throw new Error(`registry order missing: ${key}`);
  return value;
}

function assertIsoTimestamp(value: string): void {
  const timestamp = Date.parse(value);
  if (!value.trim() || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error('generatedAt must be an ISO timestamp');
  }
}

function parseRunState(value: string): SourceMetadataRunState {
  if (value === 'running' || value === 'complete' || value === 'failed' || value === 'abandoned') {
    return value;
  }
  throw new Error(`unknown source metadata run state: ${value}`);
}
