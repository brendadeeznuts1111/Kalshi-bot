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

  test("API payload schemaVersion 2", () => {
    const p = buildGlossaryApiPayload();
    expect(p.schemaVersion).toBe(2);
    expect(p.entries.length).toBe(GLOSSARY_ENTRIES.length);
    expect(p.tooltips.mid).toBe(getGlossaryEntry("mid")!.description);
    expect(p.categories.some((c) => c.id === "warehouse")).toBe(true);
    expect(p.entries.every((e) => e.kind === "ui" || e.kind === "registry" || e.kind === "composite")).toBe(
      true,
    );
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
