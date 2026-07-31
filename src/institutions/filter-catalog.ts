/**
 * Board filter catalogs — single write path via glossary `values`.
 * No parallel LEAGUE_OPTIONS / SURFACE_OPTIONS / TIER_ORDER arrays.
 *
 * @see resolveValues / orderChoicesByGlossary / glossaryFilterChoices in glossary.ts
 * @see docs/SEMANTIC_LAYER.md
 */
import {
  FILTER_CATALOG_IDS,
  glossaryFilterChoices,
  orderChoicesByGlossary,
  resolveLabel,
  resolveValues,
} from "./glossary.ts";

/** Concepts that power Events/board filter dropdowns and must declare `values`. */
export const BOARD_FILTER_CONCEPTS = FILTER_CATALOG_IDS;

export type BoardFilterConcept = (typeof BOARD_FILTER_CONCEPTS)[number];

/** Closed-set options (glossary only — empty if concept missing values). */
export function leagueOptions(): readonly string[] {
  return resolveValues("league");
}
export function surfaceOptions(): readonly string[] {
  return resolveValues("surface");
}
export function tierOptions(): readonly string[] {
  return resolveValues("tier");
}

/**
 * Live ∩ glossary: preferred glossary order, then remaining live values.
 * Use this for board filters (data-driven, catalog-ordered).
 */
export function liveFilterOptions(
  concept: string,
  live: readonly string[],
): string[] {
  return orderChoicesByGlossary(concept, live);
}

export function liveFilterChoices(
  concept: string,
  live: readonly string[],
): Array<[string, string]> {
  return glossaryFilterChoices(concept, live);
}

export function filterLabel(concept: string, fallback?: string): string {
  return resolveLabel(concept, fallback);
}

/**
 * Audit: every board filter concept must have a non-empty values list
 * (except free-text concepts like tournament/country).
 */
export function auditBoardFilterValues(): string[] {
  const errs: string[] = [];
  for (const c of BOARD_FILTER_CONCEPTS) {
    const vals = resolveValues(c);
    if (!vals.length) {
      errs.push(`Filter concept "${c}" missing glossary values[]`);
    }
  }
  return errs;
}

/** Display helper: show Unclassified when raw tier not in closed set. */
export function displayTier(raw: string | null | undefined): string {
  if (raw == null || raw === "") {
    return resolveLabel("ui.filter.unclassified", "Unclassified");
  }
  const allowed = resolveValues("tier");
  if (allowed.length && !allowed.includes(raw)) {
    return resolveLabel("ui.filter.unclassified", "Unclassified");
  }
  return raw;
}
