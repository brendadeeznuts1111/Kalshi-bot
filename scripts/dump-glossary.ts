#!/usr/bin/env bun
/**
 * Agent-facing glossary dump (self-describing concepts + registry columns).
 *   bun run glossary:dump
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildDeskColumnRegistry } from "../src/institutions/column-registry.ts";
import {
  GLOSSARY_ENTRIES,
  PENDING_REGISTRY_CONCEPTS,
  buildGlossaryApiPayload,
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

const concepts: Record<string, unknown> = {};
for (const e of GLOSSARY_ENTRIES) {
  const meta = e.kind === "registry" ? registry.byFeature.get(e.id) : undefined;
  concepts[e.id] = {
    label: e.label,
    description: e.description,
    category: e.category,
    kind: e.kind,
    mapsTo: e.mapsTo ?? null,
    synonyms: e.synonyms ?? [],
    values: e.values ?? null,
    valueLabels: e.valueLabels ?? null,
    seeAlso: e.seeAlso ?? [],
    status: e.status ?? "active",
    deprecatedBy: e.deprecatedBy ?? null,
    unit: e.unit ?? null,
    registryColumn: meta?.column ?? null,
    source: meta?.source ?? null,
    featurePurpose: meta?.featurePurpose ?? null,
  };
}

const dump = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  integrityOk: integrityErrors.length === 0,
  integrityErrors,
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
  concepts,
  api: buildGlossaryApiPayload(),
};

mkdirSync(join(root, "research/registry"), { recursive: true });
await Bun.write(outPath, JSON.stringify(dump, null, 2) + "\n");
console.log(
  `glossary:dump → ${outPath} · concepts=${Object.keys(concepts).length} · integrity=${
    integrityErrors.length === 0 ? "ok" : `${integrityErrors.length} errs`
  }`,
);
if (integrityErrors.length) {
  for (const e of integrityErrors) console.error(" ", e);
  process.exit(1);
}
