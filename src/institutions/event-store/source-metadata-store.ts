import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
  asSelectorKind,
  asSourceKey,
  asSourceMetadataId,
  asSourceRegistryFingerprint,
  unbrand,
  type AdapterId,
  type SourceMetadataRunId,
  type SourceRegistryFingerprint,
  type SourceScopeId,
} from '../market-registry/brands.ts';
import { classifySourceMetadata } from '../market-registry/metadata-classification.ts';
import {
  buildSportsSourceRegistryArtifact,
  SPORTS_SOURCE_REGISTRY,
} from '../market-registry/registry.ts';
import type {
  NormalizedSourceMetadata,
  SourceMetadataClassificationDecision,
  SportsSourceRegistry,
} from '../market-registry/types.ts';

type PersistSourceMetadataInput = {
  entity: NormalizedSourceMetadata;
  adapter: AdapterId;
  selectorScope: SourceScopeId;
  runId: SourceMetadataRunId;
  observedAtMs: number;
  classifiedAtMs: number;
  registryFingerprint: SourceRegistryFingerprint;
};

export type SourceMetadataPublisher = {
  registryFingerprint: SourceRegistryFingerprint;
  persist(db: Database, input: Omit<PersistSourceMetadataInput, 'registryFingerprint'>): number;
};

export type ReclassifySourceMetadataResult = {
  entityCount: number;
  classificationCount: number;
  registryFingerprint: SourceRegistryFingerprint;
};

export type StoredSourceMetadataWireRow = {
  sourceKey: string;
  metadataId: string; // brand-ok -- parsed immediately after the SQLite boundary
  metadataKind: string;
  label: string;
  attributesJson: string;
  facetsJson: string;
  sourceUpdatedAtMs: number | null;
};

/** Stable fingerprint of registry semantics; generation time is deliberately fixed. */
export function sourceRegistryFingerprint(
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY
): SourceRegistryFingerprint {
  const artifact = buildSportsSourceRegistryArtifact('1970-01-01T00:00:00.000Z', registry);
  return asSourceRegistryFingerprint(
    createHash('sha256').update(canonicalJson(artifact)).digest('hex')
  );
}

/** Bind publication to one validated registry fingerprint for the whole promotion transaction. */
export function createSourceMetadataPublisher(
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY
): SourceMetadataPublisher {
  const registryFingerprint = sourceRegistryFingerprint(registry);
  return {
    registryFingerprint,
    persist(db, input) {
      return persistSourceMetadataEntity(db, { ...input, registryFingerprint }, registry);
    },
  };
}

/** Persist one promoted provider entity and replace its per-sport decisions in the caller transaction. */
function persistSourceMetadataEntity(
  db: Database,
  input: PersistSourceMetadataInput,
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY
): number {
  assertTimestamp(input.observedAtMs, 'observedAtMs');
  assertTimestamp(input.classifiedAtMs, 'classifiedAtMs');
  const metadataId = unbrand(input.entity.metadataId);
  if (unbrand(asSourceMetadataId(metadataId)) !== metadataId) {
    throw new Error('metadataId must be canonical and nonblank');
  }
  const decisions = classifySourceMetadata(input.entity, registry);
  db.query(
    `INSERT INTO source_metadata_entities (
       source_key, metadata_id, metadata_kind, adapter_id, selector_scope,
       label, attributes_json, facets_json, source_updated_at_ms,
       active, retired_at_ms, last_seen_run_id,
       first_observed_at_ms, last_observed_at_ms
     ) VALUES (
       $source, $metadataId, $metadataKind, $adapter, $selectorScope,
       $label, $attributesJson, $facetsJson, $sourceUpdatedAtMs,
       0, NULL, $runId, $observedAtMs, $observedAtMs
     )
     ON CONFLICT(source_key, metadata_kind, metadata_id) DO UPDATE SET
       adapter_id = excluded.adapter_id,
       selector_scope = excluded.selector_scope,
       label = excluded.label,
       attributes_json = excluded.attributes_json,
       facets_json = excluded.facets_json,
       source_updated_at_ms = excluded.source_updated_at_ms,
       last_seen_run_id = excluded.last_seen_run_id,
       last_observed_at_ms = excluded.last_observed_at_ms`
  ).run({
    $source: unbrand(input.entity.source),
    $metadataId: metadataId,
    $metadataKind: unbrand(input.entity.metadataKind),
    $adapter: unbrand(input.adapter),
    $selectorScope: unbrand(input.selectorScope),
    $label: input.entity.label,
    $attributesJson: canonicalJson(input.entity.attributes),
    $facetsJson: canonicalJson(input.entity.facets),
    $sourceUpdatedAtMs: input.entity.sourceUpdatedAtMs ?? null,
    $runId: unbrand(input.runId),
    $observedAtMs: input.observedAtMs,
  });
  replaceClassifications(
    db,
    input.entity,
    decisions,
    input.registryFingerprint,
    input.classifiedAtMs
  );
  return decisions.length;
}

/** Re-evaluate stored provider truth against a new registry without another source fetch. */
export function reclassifySourceMetadata(
  db: Database,
  input: {
    classifiedAtMs: number;
    source?: NormalizedSourceMetadata['source'];
    includeInactive?: boolean;
  },
  registry: SportsSourceRegistry = SPORTS_SOURCE_REGISTRY
): ReclassifySourceMetadataResult {
  assertTimestamp(input.classifiedAtMs, 'classifiedAtMs');
  const fingerprint = sourceRegistryFingerprint(registry);
  let classificationCount = 0;
  let entityCount = 0;
  const apply = db.transaction(() => {
    const rows = db
      .query(
        `SELECT source_key AS sourceKey, metadata_id AS metadataId,
                metadata_kind AS metadataKind, label,
                attributes_json AS attributesJson, facets_json AS facetsJson,
                source_updated_at_ms AS sourceUpdatedAtMs
         FROM source_metadata_entities
         WHERE ($source IS NULL OR source_key = $source)
           AND ($includeInactive = 1 OR active = 1)
         ORDER BY source_key, metadata_kind, metadata_id`
      )
      .all({
        $source: input.source ? unbrand(input.source) : null,
        $includeInactive: input.includeInactive ? 1 : 0,
      }) as StoredSourceMetadataWireRow[];
    entityCount = rows.length;
    for (const row of rows) {
      const entity = sourceMetadataFromStoredRow(row);
      const decisions = classifySourceMetadata(entity, registry);
      replaceClassifications(db, entity, decisions, fingerprint, input.classifiedAtMs);
      classificationCount += decisions.length;
    }
  });
  apply.immediate();
  return { entityCount, classificationCount, registryFingerprint: fingerprint };
}

/** Parse a SQLite metadata row back into the normalized interior contract. */
export function sourceMetadataFromStoredRow(
  row: StoredSourceMetadataWireRow
): NormalizedSourceMetadata {
  return {
    source: asSourceKey(row.sourceKey),
    metadataId: asSourceMetadataId(row.metadataId),
    metadataKind: asSelectorKind(row.metadataKind),
    label: row.label,
    attributes: parseStoredStringRecord(row.attributesJson, 'metadata attributes'),
    facets: parseFacetRecord(row.facetsJson),
    ...(row.sourceUpdatedAtMs === null ? {} : { sourceUpdatedAtMs: row.sourceUpdatedAtMs }),
  };
}

function replaceClassifications(
  db: Database,
  entity: NormalizedSourceMetadata,
  decisions: readonly SourceMetadataClassificationDecision[],
  fingerprint: SourceRegistryFingerprint,
  classifiedAtMs: number
): void {
  db.query(
    `DELETE FROM source_metadata_classifications
     WHERE source_key = $source
       AND metadata_kind = $metadataKind
       AND metadata_id = $metadataId`
  ).run({
    $source: unbrand(entity.source),
    $metadataKind: unbrand(entity.metadataKind),
    $metadataId: unbrand(entity.metadataId),
  });
  const insert = db.query(
    `INSERT INTO source_metadata_classifications (
       source_key, metadata_kind, metadata_id, sport_key, disposition, reason_code,
       matched_selector_scope, registry_fingerprint, classified_at_ms
     ) VALUES (
       $source, $metadataKind, $metadataId, $sport, $disposition, $reasonCode,
       $matchedSelectorScope, $registryFingerprint, $classifiedAtMs
     )`
  );
  for (const decision of decisions) {
    insert.run({
      $source: unbrand(decision.source),
      $metadataKind: unbrand(entity.metadataKind),
      $metadataId: unbrand(decision.metadataId),
      $sport: unbrand(decision.sport),
      $disposition: decision.disposition,
      $reasonCode: unbrand(decision.reasonCode),
      $matchedSelectorScope: decision.matchedSelectorScope
        ? unbrand(decision.matchedSelectorScope)
        : null,
      $registryFingerprint: unbrand(fingerprint),
      $classifiedAtMs: classifiedAtMs,
    });
  }
}

export function parseStoredStringRecord(raw: string, label: string): Record<string, string> {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const result: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!key.trim() || typeof child !== 'string') {
      throw new Error(`${label} must contain string values`);
    }
    result[key] = child;
  }
  return result;
}

function parseFacetRecord(raw: string): Record<string, readonly string[]> {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) throw new Error('metadata facets must be an object');
  const result: Record<string, readonly string[]> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!key.trim() || !Array.isArray(child) || child.some(item => typeof item !== 'string')) {
      throw new Error('metadata facets must contain string arrays');
    }
    result[key] = child;
  }
  return result;
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

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function assertTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}
