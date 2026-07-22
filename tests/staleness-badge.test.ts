// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  formatDataFreshnessSuffix,
  formatVerificationBadge,
  resolveRunDataFreshness,
  runGeneratedAgeMs,
} from "../src/agent/audit-list.ts";
import type { ResearchRun } from "../src/research/types.ts";

function mockRun(overrides: {
  generatedAt?: string;
  cache?: ResearchRun["stats"]["cache"];
} = {}): ResearchRun {
  return {
    runId: "staleness-test-run",
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: {
      discovered: 1,
      gated: 1,
      inspected: 1,
      shortlist: 1,
      cache: overrides.cache,
    },
    candidates: [],
    gated: [],
    scored: [],
    shortlist: [],
    excludedSdkOnly: [],
  };
}

describe("formatDataFreshnessSuffix", () => {
  test("returns empty string when fresh", () => {
    expect(formatDataFreshnessSuffix({ stale: false })).toBe("");
    expect(formatDataFreshnessSuffix({ stale: false, ageMs: 3_600_000 })).toBe("");
  });

  test("returns stale label without age", () => {
    expect(formatDataFreshnessSuffix({ stale: true })).toBe(" 🕒 stale");
    expect(formatDataFreshnessSuffix({ stale: true, ageMs: null })).toBe(" 🕒 stale");
  });

  test("returns age in minutes when stale with ageMs", () => {
    expect(formatDataFreshnessSuffix({ stale: true, ageMs: 5 * 60_000 })).toBe(" 🕒 5m ago");
    expect(formatDataFreshnessSuffix({ stale: true, ageMs: 90_000 })).toBe(" 🕒 2m ago");
  });
});

describe("formatVerificationBadge with freshness", () => {
  test("fresh verified badge unchanged", () => {
    expect(
      formatVerificationBadge({
        verified: true,
        verification: "verified",
      }),
    ).toBe("✓ verified (high-value)");
  });

  test("stale verified badge includes clock suffix", () => {
    expect(
      formatVerificationBadge({
        verified: true,
        verification: "verified",
        stale: true,
        ageMs: 120_000,
      }),
    ).toBe("✓ verified (high-value) 🕒 2m ago");
  });

  test("stale unverified badge without age", () => {
    expect(
      formatVerificationBadge({
        verified: false,
        verification: "unverified",
        stale: true,
      }),
    ).toBe("✗ unverified 🕒 stale");
  });
});

describe("resolveRunDataFreshness", () => {
  test("marks fresh for recent run without degraded cache", () => {
    const run = mockRun({ generatedAt: new Date().toISOString() });
    expect(resolveRunDataFreshness(run)).toEqual({ stale: false, ageMs: expect.any(Number) });
  });

  test("marks stale when inspect cache degraded", () => {
    const run = mockRun({
      generatedAt: new Date().toISOString(),
      cache: {
        searchEtagHits: 0,
        searchDegradedHits: 0,
        inspectExactHits: 1,
        inspectDegradedHits: 2,
        apiDegradedHits: 0,
      },
    });
    const freshness = resolveRunDataFreshness(run);
    expect(freshness.stale).toBe(true);
    expect(freshness.ageMs).not.toBeNull();
  });

  test("marks stale when run generatedAt is older than 24h", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const run = mockRun({ generatedAt: old });
    const freshness = resolveRunDataFreshness(run);
    expect(freshness.stale).toBe(true);
    expect(freshness.ageMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});

describe("runGeneratedAgeMs", () => {
  test("returns null for invalid timestamp", () => {
    expect(runGeneratedAgeMs("not-a-date")).toBeNull();
  });
});
