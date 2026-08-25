import { describe, expect, test } from "bun:test";
import { versionGt } from "../../src/institutions/signal-pipeline.ts";

describe("versionGt (numeric semver compare for docs-drift)", () => {
  test("equal versions are not greater — feeds say 1.4, maps pins 1.4.0", () => {
    expect(versionGt("1.4", "1.4.0")).toBe(false);
    expect(versionGt("1.4.0", "1.4.0")).toBe(false);
    expect(versionGt("v1.4.0", "1.4.0")).toBe(false);
  });

  test("newer releases are greater", () => {
    expect(versionGt("1.4.1", "1.4.0")).toBe(true);
    expect(versionGt("1.5.0", "1.4.0")).toBe(true);
    expect(versionGt("2.0.0", "1.4.0")).toBe(true);
    expect(versionGt("1.10.0", "1.9.0")).toBe(true); // numeric, not lexical
  });

  test("older releases are not greater", () => {
    expect(versionGt("1.3.14", "1.4.0")).toBe(false);
    expect(versionGt("1.4.0", "1.4.1")).toBe(false);
  });

  test("garbage versions never false-positive a drift", () => {
    expect(versionGt("unknown", "1.4.0")).toBe(false);
    expect(versionGt("", "1.4.0")).toBe(false);
  });
});
