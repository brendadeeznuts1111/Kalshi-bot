// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  githubRepoWebUrl,
  isGitHubRepoUrl,
  localRepoPath,
  normalizeFullName,
  parseGitHubRepoRef,
  ROUTES,
} from "../src/research/patterns.ts";

describe("BunURLPattern GitHub repo SSOT", () => {
  test("parses canonical repo URL", () => {
    const ref = parseGitHubRepoRef("https://github.com/OctagonAI/kalshi-trading-bot-cli");
    expect(ref).toEqual({
      owner: "OctagonAI",
      repo: "kalshi-trading-bot-cli",
      fullName: "OctagonAI/kalshi-trading-bot-cli",
    });
  });

  test("parses .git suffixed URL", () => {
    const ref = parseGitHubRepoRef("https://github.com/foo/bar.git");
    expect(ref?.fullName).toBe("foo/bar");
  });

  test("parses deep /tree/main/src path", () => {
    const ref = parseGitHubRepoRef("https://github.com/openfi-dao/kalshi-trading-bot/tree/main/src");
    expect(ref?.fullName).toBe("openfi-dao/kalshi-trading-bot");
  });

  test("rejects non-GitHub URLs", () => {
    expect(parseGitHubRepoRef("https://gitlab.com/foo/bar")).toBeNull();
    expect(isGitHubRepoUrl("https://example.com/foo/bar")).toBe(false);
  });

  test("githubRepoWebUrl and localRepoPath share capture groups", () => {
    const ref = parseGitHubRepoRef("https://github.com/scripflipped/Krypt-Trader")!;
    expect(githubRepoWebUrl(ref.owner, ref.repo)).toBe("https://github.com/scripflipped/Krypt-Trader");
    expect(localRepoPath(ref.owner, ref.repo)).toBe("/repo/scripflipped/Krypt-Trader");
  });

  test("normalizeFullName prefers URL over wrong gh fullName", () => {
    expect(
      normalizeFullName("wrong/foo", "https://github.com/correct/bar"),
    ).toBe("correct/bar");
    expect(
      normalizeFullName("bad", "https://github.com/OctagonAI/kalshi-trading-bot-cli"),
    ).toBe("OctagonAI/kalshi-trading-bot-cli");
  });

  test("ROUTES align with localRepoPath shape", () => {
    expect(ROUTES.repo).toBe("/repo/:owner/:name");
    expect(ROUTES.runsList).toBe("/api/runs");
    expect(localRepoPath("a", "b")).toBe("/repo/a/b");
  });
});
