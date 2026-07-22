// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { applyGate } from "../src/research/gate.ts";
import type { RepoCandidate } from "../src/research/types.ts";

function repo(overrides: Partial<RepoCandidate> = {}): RepoCandidate {
  return {
    fullName: "owner/repo",
    owner: "owner",
    name: "repo",
    htmlUrl: "https://github.com/owner/repo",
    description: null,
    stars: 10,
    forks: 5,
    pushedAt: new Date().toISOString(),
    archived: false,
    topics: [],
    defaultBranch: "main",
    license: { spdxId: "MIT", name: "MIT", preferred: true, unlicensed: false },
    ...overrides,
  };
}

describe("applyGate", () => {
  test("passes repos meeting star threshold", () => {
    const result = applyGate([repo({ stars: 10, forks: 0 })], {
      minStars: 5,
      minForks: 3,
      maxAgeMonths: 18,
    });
    expect(result).toHaveLength(1);
  });

  test("passes repos meeting fork threshold without stars", () => {
    const result = applyGate([repo({ stars: 0, forks: 5 })], {
      minStars: 5,
      minForks: 3,
      maxAgeMonths: 18,
    });
    expect(result).toHaveLength(1);
  });

  test("rejects archived repos", () => {
    const result = applyGate([repo({ archived: true })], {
      minStars: 5,
      minForks: 3,
      maxAgeMonths: 18,
    });
    expect(result).toHaveLength(0);
  });

  test("rejects stale repos", () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 24);
    const result = applyGate([repo({ pushedAt: old.toISOString() })], {
      minStars: 5,
      minForks: 3,
      maxAgeMonths: 18,
    });
    expect(result).toHaveLength(0);
  });
});
