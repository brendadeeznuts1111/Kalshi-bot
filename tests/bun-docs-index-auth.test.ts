// @see https://bun.com/docs/test/mocks
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

// Token state flips per test; the module mock reads it lazily so both the
// authenticated and the fallback path are exercised without network.
let tokenState: string | null = "mock-token-123";

beforeAll(() => {
  mock.module("../src/research/github-network.ts", () => ({
    resolveGitHubToken: async (): Promise<string> => {
      if (tokenState === null) throw new Error("GitHub token not found");
      return tokenState;
    },
  }));
});

afterAll(() => {
  mock.restore();
});

describe("bun-docs-index trees API auth (GH_TOKEN trick)", () => {
  test("githubApiAuthHeaders attaches Bearer when a token resolves", async () => {
    tokenState = "mock-token-123";
    const { githubApiAuthHeaders } = await import("../tools/bun-docs-index.ts");
    const h = await githubApiAuthHeaders();
    expect(h.authorization).toBe("Bearer mock-token-123");
  });

  test("githubApiAuthHeaders degrades to {} when no token exists", async () => {
    tokenState = null;
    const { githubApiAuthHeaders } = await import("../tools/bun-docs-index.ts");
    const h = await githubApiAuthHeaders();
    expect(h.authorization).toBeUndefined();
    expect(Object.keys(h).length).toBe(0);
  });
});
