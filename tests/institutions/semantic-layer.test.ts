// @see https://bun.com/docs/test
import { describe, expect, test } from "bun:test";
import {
  DESK_EXPORT_COLUMNS,
  buildDeskColumnRegistry,
} from "../../src/institutions/column-registry.ts";
import {
  GLOSSARY_ENTRIES,
  PENDING_REGISTRY_CONCEPTS,
  buildGlossaryApiPayload,
  getGlossaryEntry,
} from "../../src/institutions/glossary.ts";
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
});
