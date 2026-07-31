/**
 * Bidirectional glossary ↔ column-registry integrity.
 * Also validates seeAlso / unit / status / deprecatedBy.
 * @see docs/SEMANTIC_LAYER.md
 */
import type { ColumnRegistry } from "./column-registry.ts";
import { isColorKey } from "../lib/color/index.ts";
import {
  GLOSSARY_STATUSES,
  UNITS,
  type GlossaryEntry,
  type GlossaryStatus,
} from "./glossary.ts";

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
  const statusSet = new Set<string>(GLOSSARY_STATUSES);

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

  // mapsTo · seeAlso · unit · status · deprecatedBy
  for (const entry of glossary.values()) {
    if (entry.mapsTo && !glossary.has(entry.mapsTo)) {
      errs.push(
        `Glossary "${entry.id}" mapsTo missing concept "${entry.mapsTo}"`,
      );
    }

    if (entry.unit != null && !(entry.unit in UNITS)) {
      errs.push(
        `Glossary "${entry.id}" has unknown unit "${entry.unit}" (want keyof UNITS)`,
      );
    }

    if (entry.color != null && !isColorKey(entry.color)) {
      errs.push(
        `Glossary "${entry.id}" has unknown color key "${entry.color}" (want ColorKey from src/lib/color/palette.ts)`,
      );
    }

    const status: GlossaryStatus = entry.status ?? "active";
    if (entry.status != null && !statusSet.has(entry.status)) {
      errs.push(
        `Glossary "${entry.id}" has invalid status "${entry.status}" (want ${GLOSSARY_STATUSES.join("|")})`,
      );
    }

    if (status === "deprecated") {
      if (!entry.deprecatedBy) {
        errs.push(
          `Glossary "${entry.id}" is deprecated but missing deprecatedBy replacement id`,
        );
      } else if (!glossary.has(entry.deprecatedBy)) {
        errs.push(
          `Glossary "${entry.id}" deprecatedBy missing concept "${entry.deprecatedBy}"`,
        );
      } else if (entry.deprecatedBy === entry.id) {
        errs.push(`Glossary "${entry.id}" deprecatedBy cannot be self`);
      }
    } else if (entry.deprecatedBy) {
      errs.push(
        `Glossary "${entry.id}" has deprecatedBy but status is "${status}" (only valid when deprecated)`,
      );
    }

    const seen = new Set<string>();
    for (const rel of entry.seeAlso ?? []) {
      if (rel === entry.id) {
        errs.push(`Glossary "${entry.id}" seeAlso cannot include self`);
        continue;
      }
      if (seen.has(rel)) {
        errs.push(`Glossary "${entry.id}" seeAlso duplicates "${rel}"`);
        continue;
      }
      seen.add(rel);
      if (!glossary.has(rel)) {
        errs.push(
          `Glossary "${entry.id}" seeAlso missing concept "${rel}"`,
        );
      }
    }
  }

  return errs;
}
