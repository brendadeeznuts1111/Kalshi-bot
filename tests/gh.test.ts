// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { isRateLimited, parseGhStdout } from "../src/research/gh.ts";

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

describe("parseGhStdout", () => {
  test("parses JSON array from gh --json", () => {
    const data = parseGhStdout<{ fullName: string }[]>('[{"fullName":"o/r"}]');
    expect(data[0]?.fullName).toBe("o/r");
  });

  test("returns empty array for empty stdout", () => {
    expect(parseGhStdout<string[]>("")).toEqual([]);
  });
});
