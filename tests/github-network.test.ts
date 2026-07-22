// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import {
  GITHUB_API_HOST,
  GITHUB_API_ORIGIN,
  resetGitHubNetworkWarmup,
  warmGitHubApiNetwork,
} from "../src/research/github-network.ts";

describe("warmGitHubApiNetwork", () => {
  afterEach(() => {
    resetGitHubNetworkWarmup();
  });

  test("is idempotent and does not throw", () => {
    expect(() => warmGitHubApiNetwork()).not.toThrow();
    expect(() => warmGitHubApiNetwork()).not.toThrow();
  });

  test("exports GitHub API host constants", () => {
    expect(GITHUB_API_HOST).toBe("api.github.com");
    expect(GITHUB_API_ORIGIN).toBe("https://api.github.com");
  });
});
