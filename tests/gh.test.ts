// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { isRateLimited } from "../src/research/github-errors.ts";

describe("isRateLimited", () => {
  test("detects GitHub REST rate limit", () => {
    expect(isRateLimited("API rate limit exceeded")).toBe(true);
  });

  test("detects HTTP 403/429 markers", () => {
    expect(isRateLimited("HTTP 403")).toBe(true);
    expect(isRateLimited("429 Too Many Requests")).toBe(true);
  });

  test("ignores normal errors", () => {
    expect(isRateLimited("gh: Not Found (HTTP 404)")).toBe(false);
  });
});

