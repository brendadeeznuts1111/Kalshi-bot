import { existsSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { openEventStore } from "../institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../institutions/event-store/paths.ts";
import { sourceRegistryFingerprint } from "../institutions/market-registry/fingerprint.ts";
import {
  buildSportsSourceDiscoveryArtifact,
  type SportsSourceDiscoveryArtifact,
} from "../institutions/event-store/source-metadata-read.ts";
import {
  buildSportsSourceRegistryArtifact,
  SPORTS_SOURCE_REGISTRY,
} from "../institutions/market-registry/registry.ts";
import { unbrand } from "../institutions/market-registry/brands.ts";
import type {
  SportsSourceRegistry,
  SportsSourceRegistryArtifact,
} from "../institutions/market-registry/types.ts";

export type SportsSourceCatalogPayload = {
  schema: "sports-source-catalog/v1";
  generatedAt: string;
  registryFingerprint: string;
  registry: SportsSourceRegistryArtifact;
  store:
    | { state: "ready" }
    | { state: "unavailable"; reason: "event_store_missing" }
    | { state: "degraded"; reason: "event_store_read_failed" };
  discovery: SportsSourceDiscoveryArtifact | null;
};

export type BuildSportsSourceCatalogOptions = {
  db?: Database;
  dbPath?: string;
  nowMs?: number;
  registry?: SportsSourceRegistry;
  onError?: (error: Error) => void;
};

/**
 * Project-facing registry payload: declared integrations always remain visible,
 * while observed venue metadata is attached only from a readable store snapshot.
 */
export function buildSportsSourceCatalogPayload(
  options: BuildSportsSourceCatalogOptions = {},
): SportsSourceCatalogPayload {
  const generatedAt = new Date(options.nowMs ?? Date.now()).toISOString();
  const registry = options.registry ?? SPORTS_SOURCE_REGISTRY;
  const declaration = buildSportsSourceRegistryArtifact(generatedAt, registry);
  const registryFingerprint = unbrand(sourceRegistryFingerprint(registry));

  if (options.db) {
    return catalogFromDb(
      options.db,
      generatedAt,
      registryFingerprint,
      declaration,
      registry,
      options.onError,
    );
  }

  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  if (!existsSync(dbPath)) {
    return {
      schema: "sports-source-catalog/v1",
      generatedAt,
      registryFingerprint,
      registry: declaration,
      store: { state: "unavailable", reason: "event_store_missing" },
      discovery: null,
    };
  }

  let db: Database | undefined;
  try {
    db = openEventStore({ dbPath, readonly: true });
    return catalogFromDb(
      db,
      generatedAt,
      registryFingerprint,
      declaration,
      registry,
      options.onError,
    );
  } catch (error) {
    options.onError?.(
      error instanceof Error ? error : new Error("unknown event-store open failure"),
    );
    return {
      schema: "sports-source-catalog/v1",
      generatedAt,
      registryFingerprint,
      registry: declaration,
      store: { state: "degraded", reason: "event_store_read_failed" },
      discovery: null,
    };
  } finally {
    db?.close();
  }
}

function catalogFromDb(
  db: Database,
  generatedAt: string,
  registryFingerprint: string,
  registry: SportsSourceRegistryArtifact,
  sourceRegistry: SportsSourceRegistry,
  onError: BuildSportsSourceCatalogOptions["onError"],
): SportsSourceCatalogPayload {
  try {
    return {
      schema: "sports-source-catalog/v1",
      generatedAt,
      registryFingerprint,
      registry,
      store: { state: "ready" },
      discovery: buildSportsSourceDiscoveryArtifact(db, generatedAt, sourceRegistry),
    };
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error("unknown event-store read failure"));
    return {
      schema: "sports-source-catalog/v1",
      generatedAt,
      registryFingerprint,
      registry,
      store: { state: "degraded", reason: "event_store_read_failed" },
      discovery: null,
    };
  }
}
