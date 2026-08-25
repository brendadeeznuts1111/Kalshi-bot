import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

const WIRE = {
  resources: {
    core: { limit: 5000, remaining: 4890, reset: 1787639999 },
    search: { limit: 30, remaining: 28, reset: 1787639999 },
    code_search: { limit: 10, remaining: 9, reset: 1787639999 },
  },
};

// Mutable flags inside the mock factories — re-registering mock.module for
// the same path in one file fights the module registry; a closure flag is
// deterministic.
let tokenResolves = true;

beforeAll(() => {
  Bun.env.GH_TOKEN = "test-token";
  mock.module("../../src/research/github-network.ts", () => ({
    GITHUB_API_HOST: "api.github.com",
    GITHUB_API_ORIGIN: "https://api.github.com",
    warmGitHubApiNetwork: () => {},
    resetGitHubNetworkWarmup: () => {},
    resolveGitHubToken: async (): Promise<string> => {
      if (!tokenResolves) throw new Error("GitHub token not found");
      return "test-token";
    },
  }));
  mock.module("../../src/research/github-rate-limit.ts", () => ({
    readGitHubRateLimitWire: async () => WIRE,
    snapshotFromWire: (wire: any, name: string) => {
      const r = wire?.resources?.[name];
      if (!r || typeof r.remaining !== "number") return null;
      return { resource: name, limit: r.limit, remaining: r.remaining, reset: r.reset };
    },
  }));
});

afterAll(() => {
  delete Bun.env.GH_TOKEN;
  mock.restore();
});

describe("github budget (live research budget channel)", () => {
  test("budgetFromWire maps all three buckets + token source", async () => {
    const { budgetFromWire, resetGithubBudgetCache } = await import("../../src/institutions/github-budget.ts");
    resetGithubBudgetCache();
    const b = budgetFromWire(WIRE as any);
    expect(b.core?.limit).toBe(5000);
    expect(b.search?.remaining).toBe(28);
    expect(b.codeSearch?.reset).toBe(1787639999);
    expect(b.tokenSource).toBe("env-gh-token");
  });

  test("collectGithubBudget returns a TTL-cached live snapshot with buckets", async () => {
    const { collectGithubBudget, resetGithubBudgetCache } = await import("../../src/institutions/github-budget.ts");
    resetGithubBudgetCache();
    const snap = await collectGithubBudget();
    expect(snap).not.toBeNull();
    expect(snap!.core!.remaining).toBe(4890);
    expect(snap!.search!.limit).toBe(30);
    expect(snap!.checkedAt).toBeTruthy();
    const again = await collectGithubBudget();
    expect(again).toBe(snap); // TTL cache hit, same identity
  });

  test("collectGithubBudget degrades to null when no token resolves", async () => {
    delete Bun.env.GH_TOKEN;
    tokenResolves = false;
    const { collectGithubBudget, resetGithubBudgetCache } = await import("../../src/institutions/github-budget.ts");
    resetGithubBudgetCache();
    expect(await collectGithubBudget()).toBeNull();
  });
});
