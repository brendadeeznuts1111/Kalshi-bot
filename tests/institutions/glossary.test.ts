// @see https://bun.com/docs/test
import { describe, expect, test } from "bun:test";
import {
  GLOSSARY_ENTRIES,
  TOOLTIPS,
  buildGlossaryApiPayload,
  getGlossaryEntry,
  glossaryEntriesByCategory,
} from "../../src/institutions/glossary.ts";

describe("glossary SSOT", () => {
  test("every entry has unique id and category", () => {
    const ids = GLOSSARY_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of GLOSSARY_ENTRIES) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.category).toBeTruthy();
    }
  });

  test("TOOLTIPS mirrors entry descriptions", () => {
    for (const e of GLOSSARY_ENTRIES) {
      expect(TOOLTIPS[e.id]).toBe(e.description);
    }
  });

  test("API payload schemaVersion 5 — concepts[] primary + resolved color", () => {
    const p = buildGlossaryApiPayload();
    expect(p.schemaVersion).toBe(5);
    expect(Array.isArray(p.concepts)).toBe(true);
    expect(p.concepts.length).toBe(GLOSSARY_ENTRIES.length);
    expect(p.entries).toBe(p.concepts); // same reference alias
    expect(p.tooltips.mid).toBe(getGlossaryEntry("mid")!.description);
    expect(p.categories.some((c) => c.id === "warehouse")).toBe(true);
    expect(p.concepts.every((e) => e.kind === "ui" || e.kind === "registry" || e.kind === "composite")).toBe(
      true,
    );
    expect(p.concepts.every((e) => e.status === "active" || e.status === "deprecated" || e.status === "draft")).toBe(
      true,
    );
    expect(p.units.cents).toBeTruthy();
    expect(p.statuses).toEqual(["active", "deprecated", "draft"]);
    expect(p.filterConceptIds.length).toBeGreaterThan(0);
    expect(p.conceptIdsByKind.ui.length).toBeGreaterThan(0);
  });

  test("groups by category", () => {
    const map = glossaryEntriesByCategory();
    expect((map.get("warehouse") ?? []).length).toBeGreaterThan(0);
    expect((map.get("trading") ?? []).length).toBeGreaterThan(0);
  });

  test("profile meta keys are present", () => {
    expect(getGlossaryEntry("avgKalshiVolumeFp")).toBeTruthy();
    expect(getGlossaryEntry("lastSeenAtMs")).toBeTruthy();
    expect(getGlossaryEntry("profilesSource")).toBeTruthy();
    expect(getGlossaryEntry("playerProfiles")).toBeTruthy();
  });
});
