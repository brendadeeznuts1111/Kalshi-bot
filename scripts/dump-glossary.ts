#!/usr/bin/env bun
/**
 * Agent-facing glossary dump (self-describing concepts + registry columns).
 *   bun run glossary:dump
 *
 * Concepts are always an **array** of records with `id` on each element.
 * `conceptsById` is a secondary index for O(1) lookup.
 *
 * @see src/institutions/glossary.ts listConcepts / docs/SEMANTIC_LAYER.md
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildDeskColumnRegistry } from "../src/institutions/column-registry.ts";
import {
  FILTER_CATALOG_IDS,
  GLOSSARY_ENTRIES,
  PENDING_REGISTRY_CONCEPTS,
  buildGlossaryApiPayload,
  conceptIdsByKind,
  conceptsById,
  listConcepts,
  type GlossaryConceptRecord,
} from "../src/institutions/glossary.ts";
import {
  glossaryMapFromEntries,
  validateGlossaryIntegrity,
} from "../src/institutions/validate-glossary-integrity.ts";

const root = join(import.meta.dir, "..");
const outPath = join(root, "research/registry/glossary-dump.json");

const registry = buildDeskColumnRegistry();
const glossary = glossaryMapFromEntries(GLOSSARY_ENTRIES);
const integrityErrors = validateGlossaryIntegrity(registry, glossary, {
  pendingRegistryConcepts: PENDING_REGISTRY_CONCEPTS,
});

/** Concept array + desk-registry enrichment (still an array, never a bare map). */
export type DumpConceptRecord = GlossaryConceptRecord & {
  registryColumn: number | null;
  source: string | null;
  featurePurpose: string | null;
};

const concepts: DumpConceptRecord[] = listConcepts().map((c) => {
  const meta = c.kind === "registry" ? registry.byFeature.get(c.id) : undefined;
  return {
    ...c,
    registryColumn: meta?.column ?? null,
    source: meta?.source ?? null,
    featurePurpose: meta?.featurePurpose ?? null,
  };
});

const dump = {
  schemaVersion: 5,
  generatedAt: new Date().toISOString(),
  integrityOk: integrityErrors.length === 0,
  integrityErrors,
  /** Ordered concept array — primary agent surface */
  concepts,
  /** Secondary id → record index */
  conceptsById: conceptsById(concepts),
  /** Kind → id arrays */
  conceptIdsByKind: conceptIdsByKind(concepts),
  /** Board filter concept ids (closed values[]) */
  filterConceptIds: [...FILTER_CATALOG_IDS],
  pendingRegistryConcepts: [...PENDING_REGISTRY_CONCEPTS],
  deskRegistry: {
    schema: registry.schema,
    columnCount: registry.byIndex.length,
    features: registry.byIndex.map((m) => ({
      column: m.column,
      feature: m.feature,
      concept: m.concept ?? null,
      featurePurpose: m.featurePurpose,
      source: m.source,
      nullable: m.nullable,
    })),
  },
  api: buildGlossaryApiPayload(),
};

mkdirSync(join(root, "research/registry"), { recursive: true });
await Bun.write(outPath, JSON.stringify(dump, null, 2) + "\n");
console.log(
  `glossary:dump → ${outPath} · concepts[]=${concepts.length} · integrity=${
    integrityErrors.length === 0 ? "ok" : `${integrityErrors.length} errs`
  }`,
);
if (integrityErrors.length) {
  for (const e of integrityErrors) console.error(" ", e);
  process.exit(1);
}
