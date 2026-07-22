// @see https://bun.com/docs/test/index#run-tests
import { afterEach, describe, expect, test } from "bun:test";
import {
  assertGitHubRateBudget,
  GitHubCacheMissError,
  GitHubRateLimitError,
  isGitHubApiAbortError,
  isGitHubCacheMissError,
  isGitHubRateLimitError,
  isGitHubRateLimitTripped,
  resetGitHubRateLimitCircuit,
  serializeGitHubApiError,
  formatRateLimitRemediation,
  beginGitHubResearchErrorContext,
  finishGitHubResearchErrorContext,
  throwCacheMissIfTripped,
  tripGitHubRateLimit,
} from "../src/research/github-errors.ts";

describe("github errors", () => {
  afterEach(() => {
    resetGitHubRateLimitCircuit();
  });

  test("trips and blocks subsequent calls", () => {
    const resetSec = Math.ceil(Date.now() / 1000) + 120;
    tripGitHubRateLimit(resetSec, "test");
    expect(isGitHubRateLimitTripped()).toBe(true);
    expect(() => assertGitHubRateBudget("inspect")).toThrow(GitHubRateLimitError);
  });

  test("throwCacheMissIfTripped throws GitHubCacheMissError", () => {
    tripGitHubRateLimit(Math.ceil(Date.now() / 1000) + 120, "search");
    expect(() => throwCacheMissIfTripped("search", "kalshi bot")).toThrow(GitHubCacheMissError);
  });

  test("clears trip after reset time passes", () => {
    tripGitHubRateLimit(Math.floor(Date.now() / 1000) - 1, "test");
    expect(isGitHubRateLimitTripped()).toBe(false);
    expect(() => assertGitHubRateBudget("discover")).not.toThrow();
  });

  test("type guards distinguish cache miss from rate limit", () => {
    const miss = new GitHubCacheMissError("no cache", {
      cacheKind: "api",
      cacheKey: "o/r:readme",
    });
    expect(isGitHubCacheMissError(miss)).toBe(true);
    expect(isGitHubRateLimitError(miss)).toBe(true);
    expect(isGitHubApiAbortError(miss)).toBe(true);
  });

  test("GitHubRateLimitError exposes reset ISO", () => {
    const resetMs = Date.now() + 60_000;
    const err = new GitHubRateLimitError("limited", { resetAtMs: resetMs, source: "gh api" });
    expect(err.resetIso()).toBe(new Date(resetMs).toISOString());
  });

  test("serializeGitHubApiError emits self-remediating wire shape", () => {
    beginGitHubResearchErrorContext({ dimension: "price-data", minStars: 1, minForks: 0 });
    const resetMs = Date.now() + 487_000;
    tripGitHubRateLimit(Math.ceil(resetMs / 1000), "search/repositories", {
      remaining: 0,
      limit: 30,
      resource: "search",
    });
    const err = new GitHubCacheMissError(
      "GitHub search rate limit exceeded and no cached result available for query",
      {
        resetAtMs: resetMs,
        source: "search/repositories",
        cacheKind: "search",
        cacheKey: "kalshi bot stars:>=5 pushed:>=2024-01-01",
      },
    );
    const wire = serializeGitHubApiError(err, {
      staleDataRunId: "2026-07-21T12-00-00-000Z",
      staleDataAgeMs: 3600_000,
      cachedDataAvailable: true,
    });
    finishGitHubResearchErrorContext();

    expect(wire.code).toBe("cache_miss");
    expect(wire.retryAfterSeconds).toBeGreaterThan(400);
    expect(wire.remediation.action).toBe("use_cached_run");
    expect(wire.remediation.command).toContain("--run=2026-07-21T12-00-00-000Z");
    expect(wire.impact.dimension).toBe("price-data");
    expect(wire.impact.blockedOperations).toEqual(["discover"]);
    expect(wire.circuit.tripped).toBe(true);
    expect(wire.circuit.limit).toBe(30);
  });

  test("formatRateLimitRemediation prints actionable CLI output", () => {
    tripGitHubRateLimit(Math.ceil((Date.now() + 480_000) / 1000), "search/repositories", {
      remaining: 0,
      limit: 30,
      resource: "search",
    });
    const err = new GitHubCacheMissError("blocked", {
      resetAtMs: Date.now() + 480_000,
      source: "search/repositories",
      cacheKind: "search",
      cacheKey: "kalshi",
      context: { dimension: "tracking" },
    });
    const text = formatRateLimitRemediation(err, {
      staleDataRunId: "2026-07-21T12-00-00-000Z",
      cachedDataAvailable: true,
    });
    expect(text).toContain("tracking blocked");
    expect(text).toContain("bun run agent patterns");
    expect(text).toContain("Circuit tripped");
  });
});
