// @see https://bun.com/docs/test
import { describe, expect, test } from "bun:test";
import {
  DESK_EXPORT_COLUMNS,
  buildDeskColumnRegistry,
} from "../../src/institutions/column-registry.ts";
import {
  GLOSSARY_ENTRIES,
  PENDING_REGISTRY_CONCEPTS,
  buildFilterCatalog,
  buildGlossaryApiPayload,
  getGlossaryEntry,
  glossaryFilterChoices,
  orderChoicesByGlossary,
  resolveLabel,
  resolveValueLabel,
  resolveValues,
} from "../../src/institutions/glossary.ts";
import {
  auditBoardFilterValues,
  displayTier,
  leagueOptions,
  surfaceOptions,
  tierOptions,
} from "../../src/institutions/filter-catalog.ts";
import {
  glossaryMapFromEntries,
  validateGlossaryIntegrity,
} from "../../src/institutions/validate-glossary-integrity.ts";

describe("semantic layer — glossary root, registry consumer", () => {
  test("desk registry is contiguous 0..n-1", () => {
    const reg = buildDeskColumnRegistry();
    expect(reg.byIndex.length).toBe(DESK_EXPORT_COLUMNS.length);
    expect(reg.byFeature.get("kalshi_mu")?.column).toBe(11);
    expect(reg.byFeature.get("poly_volume")?.concept).toBe("poly_volume");
  });

  test("every concept FK resolves with kind registry", () => {
    const reg = buildDeskColumnRegistry();
    const g = glossaryMapFromEntries(GLOSSARY_ENTRIES);
    const errs = validateGlossaryIntegrity(reg, g, {
      pendingRegistryConcepts: PENDING_REGISTRY_CONCEPTS,
    });
    expect(errs).toEqual([]);
  });

  test("detects orphan concept FK", () => {
    const broken = buildDeskColumnRegistry([
      {
        column: 0,
        feature: "x",
        concept: "does_not_exist",
        featurePurpose: "other",
        source: "test",
        nullable: true,
      },
    ]);
    const g = glossaryMapFromEntries(GLOSSARY_ENTRIES);
    const errs = validateGlossaryIntegrity(broken, g);
    expect(errs.some((e) => e.includes("does_not_exist"))).toBe(true);
  });

  test("detects wrong kind on concept FK", () => {
    const broken = buildDeskColumnRegistry([
      {
        column: 0,
        feature: "balanceCents",
        concept: "balanceCents", // ui-kind tip key
        featurePurpose: "other",
        source: "test",
        nullable: true,
      },
    ]);
    const g = glossaryMapFromEntries(GLOSSARY_ENTRIES);
    const errs = validateGlossaryIntegrity(broken, g, {
      pendingRegistryConcepts: PENDING_REGISTRY_CONCEPTS,
    });
    expect(errs.some((e) => e.includes("wrong kind"))).toBe(true);
  });

  test("API payload schemaVersion 2 includes kind", () => {
    const p = buildGlossaryApiPayload();
    expect(p.schemaVersion).toBe(2);
    const mid = p.entries.find((e) => e.id === "mid");
    expect(mid?.kind).toBe("ui");
    expect(mid?.mapsTo).toBe("kalshi_mu");
    expect(getGlossaryEntry("kalshi_mu")?.kind).toBe("registry");
  });

  test("ids unique", () => {
    const ids = GLOSSARY_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("resolveLabel / resolveValues", () => {
    expect(resolveLabel("kalshi_mu")).toBe("Kalshi µ");
    expect(resolveLabel("missing", "fallback")).toBe("fallback");
    expect(resolveValues("surface")).toContain("Hard");
    expect(resolveValues("league").length).toBeGreaterThan(0);
  });

  test("orderChoicesByGlossary prefers closed-set order", () => {
    const live = ["Grass", "Hard", "Clay", "Mystery"];
    const ordered = orderChoicesByGlossary("surface", live);
    expect(ordered.slice(0, 3)).toEqual(["Hard", "Clay", "Grass"]);
    expect(ordered).toContain("Mystery");
  });

  test("glossaryFilterChoices prefixes empty-all for domain enums", () => {
    const choices = glossaryFilterChoices("surface", ["Clay"]);
    expect(choices[0]).toEqual(["", "all"]);
    expect(choices.some(([v]) => v === "Clay")).toBe(true);
  });

  test("glossaryFilterChoices preserves when/liquidity all + valueLabels", () => {
    const when = glossaryFilterChoices("ui.events.filter.when", [
      "all",
      "live",
      "today",
      "24h",
      "week",
    ]);
    expect(when[0]).toEqual(["all", "all"]);
    expect(when.some(([v, l]) => v === "live" && l === "in play now")).toBe(true);
    expect(when.some(([v, l]) => v === "24h" && l === "next 24h")).toBe(true);
    expect(when.some(([v]) => v === "")).toBe(false);

    const liq = glossaryFilterChoices("ui.events.filter.liquidity", [
      "all",
      "priced",
      "active",
    ]);
    expect(liq.some(([v, l]) => v === "priced" && l === "has quotes")).toBe(true);
    expect(resolveValueLabel("ui.events.filter.when", "live")).toBe("in play now");
  });

  test("filter-catalog options are glossary-driven (no parallel arrays)", () => {
    expect(leagueOptions()).toEqual(resolveValues("league"));
    expect(surfaceOptions()).toEqual(resolveValues("surface"));
    expect(tierOptions()).toEqual(resolveValues("tier"));
    expect(tierOptions()[0]).toBe("GS");
    expect(auditBoardFilterValues()).toEqual([]);
  });

  test("API filterCatalog mirrors glossary closed sets", () => {
    const p = buildGlossaryApiPayload();
    const cat = buildFilterCatalog();
    expect(p.filterCatalog).toEqual(cat);
    expect(p.filterCatalog.tier.values).toContain("GS");
    expect(p.filterCatalog["ui.events.filter.when"].valueLabels.live).toBe(
      "in play now",
    );
  });

  test("displayTier maps unknown to Unclassified", () => {
    expect(displayTier("GS")).toBe("GS");
    expect(displayTier("Unc")).toBe("Unclassified");
    expect(displayTier(null)).toBe("Unclassified");
  });

  test("alert.* concepts are composite not registry", () => {
    expect(getGlossaryEntry("alert.poly_dropout")?.kind).toBe("composite");
  });
});
