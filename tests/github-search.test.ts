// @see https://bun.com/docs/test/index#run-tests
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mapGitHubSearchItem, searchGitHubRepos } from "../src/research/github-search.ts";
import { loadSearchCache, saveSearchCache, searchQueryKey } from "../src/research/cache.ts";
import { GitHubCacheMissError, resetGitHubRateLimitCircuit, tripGitHubRateLimit } from "../src/research/github-errors.ts";
import { enterTempCache, exitTempCache } from "./temp-cache.ts";

describe("mapGitHubSearchItem", () => {
  test("maps GitHub REST snake_case to discover shape", () => {
    const mapped = mapGitHubSearchItem({
      full_name: "owner/repo",
      description: "desc",
      stargazers_count: 12,
      forks_count: 3,
      pushed_at: "2026-01-01T00:00:00Z",
      archived: false,
      html_url: "https://github.com/owner/repo",
      default_branch: "main",
      license: { key: "mit", name: "MIT License", spdx_id: "MIT" },
    });
    expect(mapped.fullName).toBe("owner/repo");
    expect(mapped.stargazersCount).toBe(12);
    expect(mapped.url).toBe("https://github.com/owner/repo");
    expect(mapped.license?.key).toBe("mit");
  });
});

describe("searchGitHubRepos ETag cache", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = Bun.env.GH_TOKEN;

  beforeAll(async () => {
    await enterTempCache();
  });
  afterAll(() => {
    exitTempCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetGitHubRateLimitCircuit();
    if (originalToken === undefined) delete Bun.env.GH_TOKEN;
    else Bun.env.GH_TOKEN = originalToken;
  });

  test("returns cached payload on 304 without parsing body", async () => {
    Bun.env.GH_TOKEN = "test-token";
    const query = `etag-test-${Date.now()}`;
    const key = searchQueryKey(query);
    const cachedItems = [
      mapGitHubSearchItem({
        full_name: "cached/repo",
        description: null,
        stargazers_count: 1,
        forks_count: 0,
        pushed_at: "2026-01-01T00:00:00Z",
        archived: false,
        html_url: "https://github.com/cached/repo",
      }),
    ];
    saveSearchCache(key, query, '"abc123"', cachedItems);

    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({ "If-None-Match": '"abc123"' });
        return new Response(null, { status: 304, headers: { etag: '"abc123"' } });
      },
      { preconnect: fetch.preconnect },
    ) as typeof fetch;

    const result = await searchGitHubRepos(query, 30);
    expect(result.fromEtagCache).toBe(true);
    expect(result.items).toEqual(cachedItems);
    expect(loadSearchCache(key)?.payload).toEqual(cachedItems);
  });

  test("stores etag and payload on 200", async () => {
    Bun.env.GH_TOKEN = "test-token";
    const query = `fresh-test-${Date.now()}`;
    const key = searchQueryKey(query);

    globalThis.fetch = Object.assign(
      async () => {
        return Response.json(
          {
            items: [
              {
                full_name: "fresh/repo",
                description: "x",
                stargazers_count: 5,
                forks_count: 1,
                pushed_at: "2026-02-01T00:00:00Z",
                archived: false,
                html_url: "https://github.com/fresh/repo",
              },
            ],
          },
          { headers: { etag: '"fresh-etag"' } },
        );
      },
      { preconnect: fetch.preconnect },
    ) as typeof fetch;

    const result = await searchGitHubRepos(query, 30);
    expect(result.fromEtagCache).toBe(false);
    expect(result.items[0]?.fullName).toBe("fresh/repo");

    const stored = loadSearchCache(key);
    expect(stored?.etag).toBe('"fresh-etag"');
    expect(stored?.payload[0]?.fullName).toBe("fresh/repo");
  });

  test("uses stale cache when circuit already tripped", async () => {
    const query = `tripped-${Date.now()}`;
    const key = searchQueryKey(query);
    const cachedItems = [
      mapGitHubSearchItem({
        full_name: "stale/repo",
        description: null,
        stargazers_count: 2,
        forks_count: 0,
        pushed_at: "2026-01-01T00:00:00Z",
        archived: false,
        html_url: "https://github.com/stale/repo",
      }),
    ];
    saveSearchCache(key, query, '"etag"', cachedItems);
    tripGitHubRateLimit(Math.ceil(Date.now() / 1000) + 120, "test");

    const result = await searchGitHubRepos(query, 30);
    expect(result.degraded).toBe(true);
    expect(result.items).toEqual(cachedItems);
  });

  test("throws on 403 without retry when no cache", async () => {
    Bun.env.GH_TOKEN = "test-token";
    const query = `rate-limit-${Date.now()}`;

    globalThis.fetch = Object.assign(
      async () =>
        new Response("rate limit", {
          status: 403,
          headers: { "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + 60) },
        }),
      { preconnect: fetch.preconnect },
    ) as typeof fetch;

    await expect(searchGitHubRepos(query, 30)).rejects.toBeInstanceOf(GitHubCacheMissError);
  });
});
