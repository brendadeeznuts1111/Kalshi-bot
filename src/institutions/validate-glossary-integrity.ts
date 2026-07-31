/**
 * Bidirectional glossary ↔ column-registry integrity.
 * @see docs/SEMANTIC_LAYER.md
 */
import type { ColumnRegistry } from "./column-registry.ts";
import type { GlossaryEntry } from "./glossary.ts";

export function glossaryMapFromEntries(
  entries: readonly GlossaryEntry[],
): ReadonlyMap<string, GlossaryEntry> {
  return new Map(entries.map((e) => [e.id, e]));
}

/**
 * Validate registry concept FKs and reverse coverage for kind=registry entries.
 * Returns human-readable error strings (empty = ok).
 */
export function validateGlossaryIntegrity(
  registry: ColumnRegistry,
  glossary: ReadonlyMap<string, GlossaryEntry>,
  options: {
    /** registry-kind ids that may exist without a feature yet (planned) */
    pendingRegistryConcepts?: readonly string[];
  } = {},
): string[] {
  const errs: string[] = [];
  const pending = new Set(options.pendingRegistryConcepts ?? []);

  for (const meta of registry.byIndex) {
    if (!meta.concept) continue;
    const entry = glossary.get(meta.concept);
    if (!entry) {
      errs.push(
        `Registry feature "${meta.feature}" references missing glossary concept "${meta.concept}"`,
      );
      continue;
    }
    if (entry.kind !== "registry") {
      errs.push(
        `Registry feature "${meta.feature}" references glossary "${meta.concept}" with wrong kind "${entry.kind}" (want registry)`,
      );
    }
  }

  for (const [id, entry] of glossary) {
    if (entry.kind !== "registry") continue;
    if (pending.has(id)) continue;
    if (!registry.byFeature.has(id)) {
      // Allow concept id ≠ feature when a feature points at this concept
      const pointed = registry.byIndex.some((m) => m.concept === id);
      if (!pointed) {
        errs.push(
          `Glossary registry-concept "${id}" has no matching registry feature or concept pointer`,
        );
      }
    }
  }

  // unique glossary ids already enforced by construction elsewhere; check mapsTo targets
  for (const entry of glossary.values()) {
    if (entry.mapsTo && !glossary.has(entry.mapsTo)) {
      errs.push(
        `Glossary "${entry.id}" mapsTo missing concept "${entry.mapsTo}"`,
      );
    }
  }

  return errs;
}
