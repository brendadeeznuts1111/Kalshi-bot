// @see https://bun.com/docs/test/mocks
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const hits = new Map<string, unknown>();
let throwCodeSearch = false;

async function mockGithubApiJson(path: string): Promise<unknown> {
  if (throwCodeSearch && path.startsWith("search/code")) throw new Error("GitHub GET search/code failed (403)");
  if (path.startsWith("search/code")) {
    const q = decodeURIComponent(path.split("q=")[1]?.split("&")[0] ?? "");
    return hits.get(q) ?? { total_count: 0, items: [] };
  }
  return {};
}

beforeAll(async () => {
  // Isolated cache DB — tests must never write mock rows to the real cache.db.
  Bun.env.RESEARCH_CACHE_DB = ":memory:";
  const { resetCacheDbConnection } = await import("../src/research/cache.ts");
  resetCacheDbConnection();
  mock.module("../src/research/github-api.ts", () => ({
    githubApiJson: mockGithubApiJson,
  }));
});

afterAll(() => {
  delete Bun.env.RESEARCH_CACHE_DB;
  mock.restore();
});

describe("global code search (§127 global attribution)", () => {
  test("fetchGlobalCodeHits runs ONE query per keyword, paginated, cached", async () => {
    hits.set("KALSHI_ACCESS_KEY", {
      total_count: 150,
      items: [
        { path: "a.ts", repository: { full_name: "org/repo-a" } },
        { path: "b.ts", repository: { full_name: "org/repo-b" } },
      ],
    });
    const { fetchGlobalCodeHits, resetGlobalCodeSearchCache } = await import("../src/research/global-code-search.ts");
    resetGlobalCodeSearchCache();
    const rows = await fetchGlobalCodeHits(["KALSHI_ACCESS_KEY", "KALSHI_ACCESS_KEY"]);
    // deduped: one row, one query
    expect(rows.size).toBe(1);
    const row = rows.get("KALSHI_ACCESS_KEY")!;
    expect(row.hits).toHaveLength(2);
    expect(row.hits[0]!.repo).toBe("org/repo-a");
  });

  test("attributeCodeHits maps global hits to the per-repo detector shape", async () => {
    const { attributeCodeHits } = await import("../src/research/global-code-search.ts");
    const global = new Map([
      ["KALSHI_ACCESS_KEY", { query: "KALSHI_ACCESS_KEY", totalCount: 2, hits: [
        { path: "a.ts", repo: "org/repo-a" },
        { path: "b.ts", repo: "org/repo-b" },
      ] }],
      ["place_order", { query: "place_order", totalCount: 0, hits: [] }],
    ]);
    const attributed = attributeCodeHits(global, ["KALSHI_ACCESS_KEY", "place_order"], "org/repo-a");
    expect(attributed[0]).toEqual({ query: "KALSHI_ACCESS_KEY", totalCount: 1, paths: ["a.ts"] });
    expect(attributed[1]).toEqual({ query: "place_order", totalCount: 0, paths: [] });
  });

  test("estimateGlobalCodeSearchCalls counts distinct keywords only", async () => {
    const { estimateGlobalCodeSearchCalls } = await import("../src/research/global-code-search.ts");
    expect(estimateGlobalCodeSearchCalls(["a", "b", "a"])).toBe(2);
  });

  test("degraded (throwing) fetches are NEVER persisted to disk (§129)", async () => {
    const { fetchGlobalCodeHits, resetGlobalCodeSearchCache } = await import("../src/research/global-code-search.ts");
    const { countGlobalCodeCache, clearGlobalCodeCache } = await import("../src/research/cache.ts");
    clearGlobalCodeCache();
    resetGlobalCodeSearchCache();
    throwCodeSearch = true;
    Bun.env.GLOBAL_CODE_SEARCH_NO_PACE = "1";
    try {
      const rows = await fetchGlobalCodeHits(["KALSHI_ACCESS_KEY"]);
      expect(rows.get("KALSHI_ACCESS_KEY")!.hits).toHaveLength(0); // degraded in-process
      expect(countGlobalCodeCache()).toBe(0); // NOT on disk
    } finally {
      delete Bun.env.GLOBAL_CODE_SEARCH_NO_PACE;
      throwCodeSearch = false;
    }
  });
});
