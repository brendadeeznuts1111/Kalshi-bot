// @see https://bun.com/docs/test/index#run-tests
// @see https://bun.com/docs/test/mocks
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

beforeAll(() => {
  mock.module("../src/research/gh.ts", () => ({
    ghJson: async (args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("/readme")) {
        return { content: "websocket market maker bot", encoding: "utf8" };
      }
      if (joined.includes("search code") && joined.includes("KALSHI-ACCESS-KEY")) {
        return [{ path: "src/client.ts" }];
      }
      if (joined.includes("search code")) {
        return [];
      }
      if (joined.includes("/languages")) {
        return { TypeScript: 100 };
      }
      if (joined.includes("/commits")) {
        return [{ commit: { author: { date: new Date().toISOString() } } }];
      }
      if (joined.includes("/contents")) {
        return [{ name: "tests", type: "dir" }];
      }
      return [];
    },
    ghText: async () => "",
    isRateLimited: () => false,
    parseGhStdout: (stdout: string | Buffer) => JSON.parse(stdout.toString()),
  }));
});

afterAll(() => {
  mock.restore();
});

describe("inspectRepo (mocked gh)", () => {
  test("derives signals without network", async () => {
    const { inspectRepo } = await import("../src/research/inspect.ts");
    const { loadConfig } = await import("../src/research/discover.ts");

    const config = await loadConfig();
    const repo = {
      fullName: "mock/bot",
      owner: "mock",
      name: "bot",
      htmlUrl: "https://github.com/mock/bot",
      description: null,
      stars: 10,
      forks: 2,
      pushedAt: "2026-06-01T00:00:00Z",
      archived: false,
      topics: [],
      defaultBranch: "main",
      license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
    };

    const signals = await inspectRepo(repo, config);
    expect(signals.hasAuthInCode).toBe(true);
    expect(signals.strategyTags).toContain("market_making");
    expect(signals.hasTests).toBe(true);
  });
});
