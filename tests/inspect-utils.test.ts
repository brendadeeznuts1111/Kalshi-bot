// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { InspectionSignals } from "../src/research/types.ts";
import {
  formatInspectPersistSummary,
  formatInspectSignalsBrief,
  inspectSignalsDigest,
  inspectionSignalsEqual,
  canReusePriorInspectSnapshot,
  persistInspectCache,
} from "../src/research/inspect-utils.ts";
import { loadInspectCache, saveInspectCache } from "../src/research/cache.ts";

function sampleSignals(overrides: Partial<InspectionSignals> = {}): InspectionSignals {
  return {
    readmeLength: 100,
    hasSetupSection: true,
    hasStrategySection: false,
    authHits: [],
    orderHits: [],
    usesOfficialSdk: false,
    hasAuthInCode: true,
    hasV2Api: true,
    hasRsaPss: false,
    hasLiveOrderPath: false,
    hasDryRunDefault: true,
    hasAuthFreshness: true,
    hasCentsPriceBounds: false,
    hasTests: true,
    hasCi: false,
    languages: { TypeScript: 100 },
    primaryLanguage: "TypeScript",
    lastDefaultBranchCommitAt: "2026-02-01T00:00:00Z",
    strategyTags: ["tracking"],
    isSdkOnly: false,
    riskKeywordHits: [],
    ...overrides,
  };
}

describe("inspect-utils", () => {
  test("inspectionSignalsEqual uses Bun.deepEquals", () => {
    const a = sampleSignals();
    const b = sampleSignals();
    expect(inspectionSignalsEqual(a, b)).toBe(true);
    expect(inspectionSignalsEqual(a, sampleSignals({ hasTests: false }))).toBe(false);
  });

  test("inspectSignalsDigest is stable for equal payloads", () => {
    const a = sampleSignals();
    const b = sampleSignals();
    expect(inspectSignalsDigest(a)).toBe(inspectSignalsDigest(b));
  });

  test("canReusePriorInspectSnapshot when HEAD unchanged", () => {
    const prior = sampleSignals({ lastDefaultBranchCommitAt: "2026-02-01T00:00:00Z" });
    expect(canReusePriorInspectSnapshot(prior, "2026-02-01T00:00:00Z")).toBe(true);
    expect(canReusePriorInspectSnapshot(prior, "2026-03-01T00:00:00Z")).toBe(false);
    expect(canReusePriorInspectSnapshot(null, "2026-02-01T00:00:00Z")).toBe(false);
  });

  test("persistInspectCache skips write when unchanged", () => {
    const repo = `inspect/utils-${Date.now()}`;
    const pushedAt = "2026-03-01T12:00:00Z";
    const signals = sampleSignals();
    saveInspectCache(repo, pushedAt, signals);
    const before = loadInspectCache(repo, pushedAt);
    const result = persistInspectCache(repo, pushedAt, sampleSignals());
    expect(result.action).toBe("unchanged");
    expect(loadInspectCache(repo, pushedAt)).toEqual(before);
  });

  test("formatInspectPersistSummary mentions deepEquals for unchanged", () => {
    expect(formatInspectPersistSummary({ inserts: 0, updates: 1, unchanged: 2 })).toContain("Bun.deepEquals");
  });

  test("formatInspectSignalsBrief uses Bun.inspect", () => {
    const brief = formatInspectSignalsBrief(sampleSignals());
    expect(brief).toContain("TypeScript");
    expect(brief).toContain("tracking");
  });
});
