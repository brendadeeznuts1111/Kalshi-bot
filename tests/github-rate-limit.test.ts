// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/research/discover.ts";
import { resolveGhRateLimitResource } from "../src/research/gh.ts";
import {
  computeWaitMs,
  evaluateInspectRateBudget,
  estimateCodeSearchCallsPerRepo,
  maxWaitMsForResource,
  parseRateLimitWire,
  resolveGhRateLimitResource as resolveResource,
} from "../src/research/github-rate-limit.ts";

describe("github-rate-limit", () => {
  test("resolveGhRateLimitResource maps gh argv to buckets", () => {
    expect(resolveGhRateLimitResource(["search", "code", "term", "repo:o/r"])).toBe("code_search");
    expect(resolveGhRateLimitResource(["search", "repos", "kalshi"])).toBe("search");
    expect(resolveGhRateLimitResource(["api", "repos/o/r/readme"])).toBe("core");
    expect(resolveResource(["search", "code", "x"])).toBe("code_search");
  });

  test("computeWaitMs caps code_search waits at 2 minutes", () => {
    const now = 1_700_000_000_000;
    const resetSec = Math.floor(now / 1000) + 45;
    const codeWait = computeWaitMs(resetSec, now, "code_search");
    expect(codeWait).toBeLessThanOrEqual(maxWaitMsForResource("code_search"));
    expect(codeWait).toBe(47_000);
  });

  test("evaluateInspectRateBudget fails fast when code_search quota insufficient", () => {
    const est = evaluateInspectRateBudget({
      repoCount: 49,
      uncachedRepoCount: 49,
      codeSearchPerRepo: 20,
      codeSearch: { resource: "code_search", limit: 10, remaining: 10, reset: 1_700_000_100 },
      minRemaining: 3,
    });
    expect(est.canProceed).toBe(false);
    expect(est.estimatedCodeSearchCalls).toBe(980);
    expect(est.reason).toContain("980 code_search calls");
  });

  test("evaluateInspectRateBudget passes when cache covers all repos", () => {
    const est = evaluateInspectRateBudget({
      repoCount: 49,
      uncachedRepoCount: 0,
      codeSearchPerRepo: 20,
      codeSearch: { resource: "code_search", limit: 10, remaining: 0, reset: 1_700_000_100 },
    });
    expect(est.canProceed).toBe(true);
    expect(est.estimatedCodeSearchCalls).toBe(0);
  });

  test("parseRateLimitWire extracts code_search bucket", () => {
    const parsed = parseRateLimitWire({
      resources: {
        core: { limit: 5000, remaining: 4999, reset: 1_700_000_000 },
        code_search: { limit: 10, remaining: 2, reset: 1_700_000_060 },
      },
    });
    expect(parsed.code_search?.remaining).toBe(2);
    expect(parsed.code_search?.resource).toBe("code_search");
  });

  test("estimateCodeSearchCallsPerRepo counts auth + order queries", async () => {
    const config = await loadConfig();
    expect(estimateCodeSearchCallsPerRepo(config)).toBe(
      config.keywords.authCodeSearch.length + config.keywords.orderCodeSearch.length,
    );
  });
});
