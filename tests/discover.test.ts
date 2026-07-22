// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { parseLicense, buildRepoSearchQuery } from "../src/research/discover.ts";

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
