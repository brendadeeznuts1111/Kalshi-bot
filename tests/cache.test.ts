// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { cacheHash, isProductionRunId, listRunSummaries, saveRun, loadRunFromDb, searchCachedPayloads, withCache } from "../src/research/cache.ts";

describe("isProductionRunId", () => {
  test("accepts ISO pipeline run ids", () => {
    expect(isProductionRunId("2026-07-22T04-59-00-818Z")).toBe(true);
  });

  test("rejects test fixture ids", () => {
    expect(isProductionRunId("serve-test-run")).toBe(false);
  });
});

describe("cacheHash", () => {
  test("is stable for same repo+endpoint+pushedAt", () => {
    const a = cacheHash("o/r", "readme", "2026-01-01T00:00:00Z");
    const b = cacheHash("o/r", "readme", "2026-01-01T00:00:00Z");
    expect(a).toBe(b);
  });

  test("changes when pushedAt changes", () => {
    const a = cacheHash("o/r", "readme", "2026-01-01T00:00:00Z");
    const b = cacheHash("o/r", "readme", "2026-02-01T00:00:00Z");
    expect(a).not.toBe(b);
  });
});

describe("withCache + runs", () => {
  test("stores and retrieves API payload", async () => {
    const repo = `test/repo-${Date.now()}`;
    let calls = 0;
    const value = await withCache(repo, "2026-01-01T00:00:00Z", "test_endpoint", async () => {
      calls++;
      return { ok: true };
    });
    expect(value).toEqual({ ok: true });
    expect(calls).toBe(1);

    const again = await withCache(repo, "2026-01-01T00:00:00Z", "test_endpoint", async () => {
      calls++;
      return { ok: false };
    });
    expect(again).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  test("searchCachedReadmes finds substring in readme endpoint", async () => {
    await withCache("search/repo", "2026-01-02T00:00:00Z", "readme", async () => "mentions websocket feed");
    const hits = searchCachedPayloads("readme", "websocket");
    expect(hits.some((h) => h.repo === "search/repo")).toBe(true);
  });

  test("saveRun and loadRunFromDb round-trip", () => {
    const payload = {
      runId: "test-run-id",
      generatedAt: "2026-01-01T00:00:00Z",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 1 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    };
    saveRun("test-run-id", "2026-01-01T00:00:00Z", payload);
    const loaded = loadRunFromDb("test-run-id");
    expect(loaded?.runId).toBe("test-run-id");
  });

  test("listRunSummaries returns stats from saved runs", () => {
    saveRun("summary-run", "2099-06-01T00:00:00.000Z", {
      runId: "summary-run",
      generatedAt: "2099-06-01T00:00:00.000Z",
      config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
      stats: { discovered: 9, gated: 4, inspected: 4, shortlist: 2 },
      candidates: [],
      gated: [],
      scored: [],
      shortlist: [],
      excludedSdkOnly: [],
    });
    const hit = listRunSummaries().find((s) => s.runId === "summary-run");
    expect(hit?.discovered).toBe(9);
    expect(hit?.shortlist).toBe(2);
  });
});
