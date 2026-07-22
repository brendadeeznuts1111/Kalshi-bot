// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { emptyPatternHits } from "../src/agent/pattern-extract.ts";
import type { RepoPatternReport } from "../src/agent/pattern-extract.ts";
import {
  attachPatternMisses,
  formatPatternMissSummary,
  patternMissForComponent,
  patternMissSuggestions,
} from "../src/agent/pattern-miss.ts";

function emptyRepo(overrides: Partial<RepoPatternReport> = {}): RepoPatternReport {
  return {
    fullName: "owner/tracker",
    score: 55,
    verification: "✗ unverified",
    evidencePaths: ["README.md"],
    summary: emptyPatternHits(),
    files: [
      {
        path: "README.md",
        components: ["authApi"],
        hits: emptyPatternHits(),
        excerpt: "Kalshi portfolio tracker without API headers",
        fetchOk: true,
      },
    ],
    ...overrides,
  };
}

describe("pattern-miss", () => {
  test("patternMissSuggestions lists manual search hints when summary empty", () => {
    const misses = patternMissSuggestions(emptyRepo());
    expect(misses.length).toBeGreaterThan(0);
    expect(misses[0]?.hint).toContain("Manual review");
    expect(misses[0]?.hint).toContain("README.md");
  });

  test("patternMissForComponent scopes to auth for authApi", () => {
    const misses = patternMissForComponent(emptyRepo(), ["auth"]);
    expect(misses).toHaveLength(1);
    expect(misses[0]?.category).toBe("auth");
    expect(misses[0]?.searchTerm).toContain("KALSHI");
  });

  test("attachPatternMisses adds patternMiss field", () => {
    const withMiss = attachPatternMisses(emptyRepo());
    expect(withMiss.patternMiss?.length).toBeGreaterThan(0);
  });

  test("formatPatternMissSummary joins hints", () => {
    const misses = patternMissSuggestions(emptyRepo(), { max: 2 });
    const text = formatPatternMissSummary(misses);
    expect(text).toContain("Manual review");
  });
});
