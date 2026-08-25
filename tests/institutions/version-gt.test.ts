import { describe, expect, test } from "bun:test";
import { normalizeSemver, versionGt } from "../../src/institutions/signal-pipeline.ts";

describe("normalizeSemver (pad ragged feed versions before Bun.semver)", () => {
  test("pads to major.minor.patch and strips leading v", () => {
    expect(normalizeSemver("1.4")).toBe("1.4.0");
    expect(normalizeSemver("v1.4")).toBe("1.4.0");
    expect(normalizeSemver("2")).toBe("2.0.0");
    expect(normalizeSemver("1.10.0")).toBe("1.10.0");
  });

  test("rejects garbage and prereleases", () => {
    expect(normalizeSemver("unknown")).toBeNull();
    expect(normalizeSemver("")).toBeNull();
    expect(normalizeSemver("1.4.0-beta")).toBeNull();
    expect(normalizeSemver("1.4.0.0")).toBeNull(); // 4 segments
  });
});

describe("versionGt (Bun.semver.order after normalization — docs-drift)", () => {
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
