// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/test/mocks
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

async function mockGithubApiJson(path: string): Promise<unknown> {
  if (path.includes("/readme")) {
    return { content: "websocket market maker bot", encoding: "utf8" };
  }
  if (path.startsWith("search/code")) {
    const q = decodeURIComponent(path.split("q=")[1]?.split("&")[0] ?? "");
    if (q.includes("KALSHI-ACCESS-KEY")) {
      return { total_count: 1, items: [{ path: "src/client.ts" }] };
    }
    return { total_count: 0, items: [] };
  }
  if (path.includes("/languages")) {
    return { TypeScript: 100 };
  }
  if (path.includes("/commits")) {
    return [{ commit: { author: { date: new Date().toISOString() } } }];
  }
  if (path.includes("/contents")) {
    return [{ name: "tests", type: "dir" }];
  }
  return {};
}

beforeAll(() => {
  mock.module("../src/research/github-api.ts", () => ({
    githubApiJson: mockGithubApiJson,
    githubApiGet: async (path: string) => ({
      data: await mockGithubApiJson(path),
      etag: null,
      status: 200,
      notModified: false,
    }),
  }));
});

afterAll(() => {
  mock.restore();
});

describe("inspectRepo (mocked github-api)", () => {
  test("derives signals without network", async () => {
    const { inspectRepo } = await import("../src/research/inspect.ts");
    const { loadConfig } = await import("../src/research/discover.ts");
    const { loadInspectCache } = await import("../src/research/cache.ts");

    const config = await loadConfig();
    const stamp = Date.now();
    const repo = {
      fullName: `mock/bot-${stamp}`,
      owner: "mock",
      name: `bot-${stamp}`,
      htmlUrl: `https://github.com/mock/bot-${stamp}`,
      description: null,
      stars: 10,
      forks: 2,
      pushedAt: new Date(stamp).toISOString(),
      archived: false,
      topics: [],
      defaultBranch: "main",
      license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
    };

    expect(loadInspectCache(repo.fullName, repo.pushedAt)).toBeNull();

    const signals = await inspectRepo(repo, config);
    expect(signals.hasAuthInCode).toBe(true);
    expect(signals.strategyTags).toContain("market_making");
    expect(signals.hasTests).toBe(true);
  });
});
