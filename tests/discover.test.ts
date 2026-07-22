// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  parseLicense,
  buildRepoSearchQuery,
  gateCutoffIsoDate,
  hasBarePhraseInStrippedQueries,
  inferDiscoverGateFromCachedQueries,
  inferDiscoverGateFromSearchQueries,
  stripRepoSearchQualifiers,
} from "../src/research/discover.ts";

describe("buildRepoSearchQuery", () => {
  test("appends stars and pushed filters when absent", () => {
    const q = buildRepoSearchQuery('"kalshi" in:name', {
      minStars: 5,
      minForks: 3,
      maxAgeMonths: 18,
    });
    expect(q).toContain('"kalshi" in:name');
    expect(q).toContain("stars:>=5");
    expect(q).toMatch(/pushed:>=\d{4}-\d{2}-\d{2}/);
  });

  test("does not duplicate existing qualifiers", () => {
    const q = buildRepoSearchQuery('kalshi stars:>=2 pushed:>=2024-01-01', {
      minStars: 5,
      minForks: 3,
      maxAgeMonths: 18,
    });
    expect(q).toBe("kalshi stars:>=2 pushed:>=2024-01-01");
  });

  test("uses forks when minStars is zero", () => {
    const q = buildRepoSearchQuery("kalshi", { minStars: 0, minForks: 3, maxAgeMonths: 12 });
    expect(q).toContain("forks:>=3");
    expect(q).not.toContain("stars:");
  });
});

describe("gateCutoffIsoDate", () => {
  test("is stable within a UTC calendar month", () => {
    const jul1 = gateCutoffIsoDate(18, Date.UTC(2026, 6, 1));
    const jul22 = gateCutoffIsoDate(18, Date.UTC(2026, 6, 22));
    const aug1 = gateCutoffIsoDate(18, Date.UTC(2026, 7, 1));
    expect(jul1).toBe("2025-01-01");
    expect(jul22).toBe("2025-01-01");
    expect(aug1).toBe("2025-02-01");
  });
});

describe("stripRepoSearchQualifiers", () => {
  test("normalizes stars/forks/pushed eras to the bare query", () => {
    expect(
      stripRepoSearchQualifiers("kalshi websocket stars:>=1 pushed:>=2025-01-22"),
    ).toBe("kalshi websocket");
    expect(
      stripRepoSearchQualifiers("kalshi websocket pushed:>=2025-01-22"),
    ).toBe("kalshi websocket");
  });
});

describe("inferDiscoverGateFromSearchQueries", () => {
  const apply = { minStars: 5, minForks: 3, maxAgeMonths: 18 };

  test("takes mode of stars/forks qualifiers", () => {
    const gate = inferDiscoverGateFromSearchQueries(
      [
        "kalshi websocket stars:>=1 pushed:>=2025-01-01",
        "kalshi orderbook feed stars:>=1 pushed:>=2025-01-01",
        "other query pushed:>=2025-01-01",
      ],
      apply,
    );
    expect(gate).toEqual({ minStars: 1, minForks: 0, maxAgeMonths: 18 });
  });

  test("infers from cache rows matching dimension bares", () => {
    const gate = inferDiscoverGateFromCachedQueries(
      ["kalshi websocket", "kalshi orderbook feed"],
      [
        "kalshi websocket stars:>=1 pushed:>=2025-01-01",
        "unrelated stars:>=99 pushed:>=2025-01-01",
      ],
      apply,
    );
    expect(gate).toEqual({ minStars: 1, minForks: 0, maxAgeMonths: 18 });
  });
});

describe("hasBarePhraseInStrippedQueries", () => {
  test("requires whitespace boundaries and min length", () => {
    expect(hasBarePhraseInStrippedQueries("nba", ["kalshi nba bot"])).toBe(false);
    expect(
      hasBarePhraseInStrippedQueries("kalshi nba", ["polymarket kalshi nba model"]),
    ).toBe(true);
    expect(
      hasBarePhraseInStrippedQueries("kalshi nba", ["polymarketkalshinbamodel"]),
    ).toBe(false);
  });
});

describe("parseLicense", () => {
  test("maps gh CLI license.key to spdxId", () => {
    const parsed = parseLicense(
      { key: "mit", name: "MIT License" },
      ["mit"],
    );
    expect(parsed.spdxId).toBe("mit");
    expect(parsed.name).toBe("MIT License");
    expect(parsed.preferred).toBe(true);
    expect(parsed.unlicensed).toBe(false);
  });

  test("treats empty gh license as unlicensed", () => {
    const parsed = parseLicense({ key: "", name: "" }, ["mit"]);
    expect(parsed.spdxId).toBeNull();
    expect(parsed.unlicensed).toBe(true);
  });
});
