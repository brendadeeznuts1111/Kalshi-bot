// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { parseLicense } from "../src/research/discover.ts";

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
