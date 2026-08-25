import { describe, expect, test } from "bun:test";
import {
  SEMVER_NEQ_QUIRK_1_4,
  normalizeSemver,
  semverCore,
  versionGt,
} from "../../src/lib/semver.ts";

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

describe("semverCore (leading numeric triple for major/minor/patch)", () => {
  test("extracts the core from prerelease/build versions", () => {
    expect(semverCore("2.1.0-beta.1")).toEqual([2, 1, 0]);
    expect(semverCore("v1.2.3+build")).toEqual([1, 2, 3]);
    expect(semverCore("1.4.0")).toEqual([1, 4, 0]);
    expect(semverCore("1.4")).toBeNull(); // ragged — no full triple
  });

  test("null for no leading triple", () => {
    expect(semverCore("unknown")).toBeNull();
    expect(semverCore("")).toBeNull();
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

describe("Bun.semver 1.4.0 quirks (pinned — recheck on upgrade)", () => {
  test("!= comparator is effectively always true (§149)", () => {
    expect(SEMVER_NEQ_QUIRK_1_4).toBe(true);
    expect(Bun.semver.satisfies("1.0.0", "!=1.0.0")).toBe(true); // quirk
    expect(Bun.semver.satisfies("1.2.0", "!=1.x")).toBe(true); // quirk
  });

  test("ragged order inflation: missing components are larger (§147)", () => {
    expect(Bun.semver.order("1", "1.0.0")).toBe(1);
    expect(Bun.semver.order("0", "0.0.0")).toBe(1);
  });
});
