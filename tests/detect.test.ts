// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  deriveCodeSignals,
  detectStrategyTags,
  detectTestsAndCi,
  isSdkOnlyRepo,
} from "../src/research/detect.ts";
import type { ResearchConfig } from "../src/research/types.ts";

const config: ResearchConfig = {
  queries: { candidateCap: 100, queries: [] },
  weights: {
    shortlistSize: 12,
    maxPerTag: 4,
    stackTiebreakThreshold: 5,
    gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 },
    components: {
      authApi: 25,
      orderRealism: 25,
      testsCi: 15,
      docsSetup: 15,
      maintenance: 10,
      riskControls: 10,
    },
    license: { unlicensedPenalty: 15, preferredLicenses: ["mit"] },
  },
  keywords: {
    authCodeSearch: [],
    orderCodeSearch: [],
    riskKeywords: ["kelly"],
    strategyTags: {
      market_making: ["market maker"],
      arb: ["arbitrage", "polymarket"],
      momentum: ["momentum"],
    },
    majorStrategyTags: ["market_making", "arb"],
  },
};

describe("detectStrategyTags", () => {
  test("detects multiple strategy tags", () => {
    const tags = detectStrategyTags("polymarket arbitrage market maker", config);
    expect(tags).toContain("arb");
    expect(tags).toContain("market_making");
  });

  test("defaults to news_event when no match", () => {
    expect(detectStrategyTags("hello world", config)).toEqual(["news_event"]);
  });
});

describe("detectTestsAndCi", () => {
  test("detects test directory and CI folder", () => {
    const result = detectTestsAndCi([{ name: "tests" }, { name: ".github" }], "");
    expect(result.hasTests).toBe(true);
    expect(result.hasCi).toBe(true);
  });
});

describe("deriveCodeSignals", () => {
  test("detects auth and order markers from code hits", () => {
    const result = deriveCodeSignals(
      "# bot",
      [{ query: "KALSHI-ACCESS-KEY", totalCount: 1, paths: ["src/client.ts"] }],
      [{ query: "create_order", totalCount: 1, paths: ["src/orders.ts"] }],
      config,
    );
    expect(result.hasAuthInCode).toBe(true);
    expect(result.hasLiveOrderPath).toBe(true);
  });
});

describe("isSdkOnlyRepo", () => {
  test("flags sdk-only readme pattern", () => {
    expect(
      isSdkOnlyRepo(["news_event"], true, false, "A lightweight kalshi api client wrapper"),
    ).toBe(true);
  });
});
