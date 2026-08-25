// licenses-policy unit tests (§92/§93) — pure logic, no subprocess.
import { describe, expect, test } from "bun:test";
import { evaluatePackage, findStaleExemptions, normalizeLicense, validatePolicyConfig } from "../../src/lib/licenses-policy.ts";
import type { LicenseExemption, LicensePolicy } from "../../src/lib/licenses-policy.ts";

const policy: LicensePolicy = {
  allowedLicenses: ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"],
  licenseAliases: { BSD: "BSD-3-Clause", "Apache 2.0": "Apache-2.0" },
};
const TODAY = "2026-08-24";

describe("normalizeLicense (§93)", () => {
  test("canonical ids pass through unchanged", () => {
    expect(normalizeLicense("MIT", policy)).toBe("MIT");
    expect(normalizeLicense("Apache-2.0", policy)).toBe("Apache-2.0");
  });

  test("aliases resolve to canonical ids", () => {
    expect(normalizeLicense("BSD", policy)).toBe("BSD-3-Clause");
    expect(normalizeLicense("Apache 2.0", policy)).toBe("Apache-2.0");
  });

  test("case-insensitive fallback returns the canonical form", () => {
    expect(normalizeLicense("mit", policy)).toBe("MIT");
    expect(normalizeLicense("apache-2.0", policy)).toBe("Apache-2.0");
    expect(normalizeLicense("BSD-3-CLAUSE", policy)).toBe("BSD-3-Clause");
  });

  test("unknown licenses pass through untouched", () => {
    expect(normalizeLicense("GPL-3.0", policy)).toBe("GPL-3.0");
    expect(normalizeLicense("Proprietary", policy)).toBe("Proprietary");
  });
});

describe("evaluatePackage (§92/§93)", () => {
  const base = { name: "pkg", version: "1.0.0", reportedLicense: "MIT" };

  test("allowlisted license passes", () => {
    const v = evaluatePackage(base, policy, [], TODAY);
    expect(v.allowed).toBe(true);
    expect(v.matchedBy).toBe("allowlist");
  });

  test("aliased license passes via allowlist", () => {
    const v = evaluatePackage({ ...base, reportedLicense: "BSD" }, policy, [], TODAY);
    expect(v.allowed).toBe(true);
    expect(v.normalizedLicense).toBe("BSD-3-Clause");
  });

  test("unknown license with no exemption fails", () => {
    const v = evaluatePackage({ ...base, reportedLicense: "GPL-3.0" }, policy, [], TODAY);
    expect(v.allowed).toBe(false);
    expect(v.matchedBy).toBeNull();
  });

  test("exemption with license scope applies", () => {
    const ex: LicenseExemption[] = [{ name: "pkg", license: "Unknown", reason: "vendored" }];
    const v = evaluatePackage({ ...base, reportedLicense: "Unknown" }, policy, ex, TODAY);
    expect(v.allowed).toBe(true);
    expect(v.matchedBy).toBe("exemption");
  });

  test("exemption does NOT mask a different license", () => {
    const ex: LicenseExemption[] = [{ name: "pkg", license: "Unknown", reason: "vendored" }];
    const v = evaluatePackage({ ...base, reportedLicense: "GPL-3.0" }, policy, ex, TODAY);
    expect(v.allowed).toBe(false);
  });

  test("version-scoped exemption misses other versions", () => {
    const ex: LicenseExemption[] = [{ name: "pkg", license: "Unknown", version: "1.0.0" }];
    const v = evaluatePackage({ ...base, reportedLicense: "Unknown", version: "2.0.0" }, policy, ex, TODAY);
    expect(v.allowed).toBe(false);
    const ok = evaluatePackage({ ...base, reportedLicense: "Unknown", version: "1.0.0" }, policy, ex, TODAY);
    expect(ok.allowed).toBe(true);
  });

  test("EXPIRED exemption fails the gate", () => {
    const ex: LicenseExemption[] = [{ name: "pkg", license: "Unknown", expires: "2026-01-01" }];
    const v = evaluatePackage({ ...base, reportedLicense: "Unknown" }, policy, ex, TODAY);
    expect(v.allowed).toBe(false);
    expect(v.reason ?? "").toContain("expired");
  });
});

describe("findStaleExemptions + validatePolicyConfig (§93)", () => {
  test("exemption for a missing package is reported stale", () => {
    const stale = findStaleExemptions([{ name: "a" }], [{ name: "ghost" }]);
    expect(stale.length).toBe(1);
    expect(stale[0].name).toBe("ghost");
  });

  test("config validation rejects malformed shapes", () => {
    expect(validatePolicyConfig(null)).not.toBeNull();
    expect(validatePolicyConfig({})).not.toBeNull();
    expect(validatePolicyConfig({ policy: { allowedLicenses: [] } })).not.toBeNull();
    expect(validatePolicyConfig({ policy: { allowedLicenses: ["MIT"] }, exemptions: [{ name: "x", expires: "not-a-date" }] })).not.toBeNull();
    expect(validatePolicyConfig({ policy: { allowedLicenses: ["MIT"], licenseAliases: {} }, exemptions: [] })).toBeNull();
  });
});
