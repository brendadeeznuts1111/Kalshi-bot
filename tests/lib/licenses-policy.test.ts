// licenses-policy unit tests (§92/§93) — pure logic, no subprocess.
import { describe, expect, test } from "bun:test";
import { advisoryFor, evaluateLicenseExpression, evaluatePackage, findStaleExemptions, normalizeAuditOverlay, normalizeLicense, validateAuditOverrides, validatePolicyConfig, wholeDaysBetween } from "../../src/lib/licenses-policy.ts";
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
describe("remediation + audit overlay (§94)", () => {
  test("expired exemption reason includes the remediation action", () => {
    const ex: LicenseExemption[] = [{ name: "pkg", license: "Unknown", expires: "2026-01-01", remediation: "upgrade to v2" }];
    const v = evaluatePackage({ name: "pkg", version: "1.0.0", reportedLicense: "Unknown" }, policy, ex, TODAY);
    expect(v.allowed).toBe(false);
    expect(v.reason ?? "").toContain("Action: upgrade to v2");
  });

  test("unexpired exemption reason does NOT carry the action", () => {
    const ex: LicenseExemption[] = [{ name: "pkg", license: "Unknown", expires: "2027-01-01", remediation: "upgrade to v2" }];
    const v = evaluatePackage({ name: "pkg", version: "1.0.0", reportedLicense: "Unknown" }, policy, ex, TODAY);
    expect(v.allowed).toBe(true);
    expect(v.reason ?? "").not.toContain("Action:");
  });

  test("validateAuditOverrides accepts shorthand and object forms", () => {
    expect(validateAuditOverrides({ advisories: { "a@1.0.0": "high" } })).toBeNull();
    expect(validateAuditOverrides({ advisories: { "a@1.0.0": { severity: "critical", note: "RCE" } } })).toBeNull();
    expect(validateAuditOverrides({ "a@1.0.0": "high" })).toBeNull();
  });

  test("validateAuditOverrides rejects malformed entries", () => {
    expect(validateAuditOverrides({ advisories: { nope: "high" } })).not.toBeNull();
    expect(validateAuditOverrides({ advisories: { "a@1.0.0": {} } })).not.toBeNull();
    expect(validateAuditOverrides({ advisories: { "a@1.0.0": { severity: 7 } } })).not.toBeNull();
    expect(validateAuditOverrides([])).not.toBeNull();
  });

  test("advisoryFor matches name@version exactly and misses otherwise", () => {
    const overlay = normalizeAuditOverlay({ advisories: { "zod@4.4.3": { severity: "high", note: "test" } } });
    expect(advisoryFor("zod", "4.4.3", overlay)?.severity).toBe("high");
    expect(advisoryFor("zod", "4.4.4", overlay)).toBeNull();
    expect(advisoryFor("other", "4.4.3", overlay)).toBeNull();
  });
});
describe("SPDX expressions + expiry warning window (§96)", () => {
  test("OR expressions pass when any alternative is allowed", () => {
    const v = evaluatePackage({ name: "x", version: "1.0.0", reportedLicense: "(MIT OR Apache-2.0)" }, policy, [], TODAY);
    expect(v.allowed).toBe(true);
    expect(v.matchedBy).toBe("expression");
  });

  test("AND expressions require ALL alternatives allowed", () => {
    const v = evaluatePackage({ name: "x", version: "1.0.0", reportedLicense: "MIT AND GPL-3.0" }, policy, [], TODAY);
    expect(v.allowed).toBe(false);
    expect(v.reason ?? "").toContain("no permissive alternative");
    const ok = evaluatePackage({ name: "x", version: "1.0.0", reportedLicense: "MIT AND BSD-3-Clause" }, policy, [], TODAY);
    expect(ok.allowed).toBe(true);
  });

  test("nested parentheses evaluate recursively", () => {
    const v = evaluateLicenseExpression("((MIT OR GPL-3.0))", policy);
    expect(v.isExpression).toBe(true);
    expect(v.allowed).toBe(true);
  });

  test("GPL-2.0-or-later is NOT split (lowercase or is not an operator)", () => {
    const v = evaluateLicenseExpression("GPL-2.0-or-later", policy);
    expect(v.isExpression).toBe(false);
    const p = evaluatePackage({ name: "x", version: "1.0.0", reportedLicense: "GPL-2.0-or-later" }, policy, [], TODAY);
    expect(p.allowed).toBe(false);
  });

  test("exemption verdict carries expires + expiresInDays for the warning window", () => {
    const ex: LicenseExemption[] = [{ name: "pkg", license: "Unknown", expires: "2026-10-01" }];
    const v = evaluatePackage({ name: "pkg", version: "1.0.0", reportedLicense: "Unknown" }, policy, ex, TODAY);
    expect(v.expires).toBe("2026-10-01");
    expect(v.expiresInDays).toBe(38); // 2026-08-24 -> 2026-10-01
    expect(wholeDaysBetween("2026-08-24", "2026-08-25")).toBe(1);
  });

  test("validatePolicyConfig rejects a bad expiryWarningDays", () => {
    expect(validatePolicyConfig({ policy: { allowedLicenses: ["MIT"], expiryWarningDays: -1 }, exemptions: [] })).not.toBeNull();
    expect(validatePolicyConfig({ policy: { allowedLicenses: ["MIT"], expiryWarningDays: 1.5 }, exemptions: [] })).not.toBeNull();
    expect(validatePolicyConfig({ policy: { allowedLicenses: ["MIT"], expiryWarningDays: 30 }, exemptions: [] })).toBeNull();
  });
});
describe("SPDX WITH exceptions + pseudo-license diagnostics (§102)", () => {
  test("WITH modifiers evaluate the BASE license (allowed base passes)", () => {
    const v = evaluatePackage({ name: "x", version: "1.0.0", reportedLicense: "MIT WITH LLVM-exception" }, policy, [], TODAY);
    expect(v.allowed).toBe(true);
    expect(v.matchedBy).toBe("expression");
  });

  test("WITH modifiers do NOT rescue a non-permissive base", () => {
    const v = evaluatePackage({ name: "x", version: "1.0.0", reportedLicense: "GPL-2.0 WITH Classpath-exception-2.0" }, policy, [], TODAY);
    expect(v.allowed).toBe(false);
    expect(v.reason ?? "").toContain("no permissive alternative");
  });

  test("WITH combines with parenthesized OR", () => {
    const v = evaluateLicenseExpression("(MIT OR GPL-2.0) WITH LLVM-exception", policy);
    expect(v.isExpression).toBe(true);
    expect(v.allowed).toBe(true);
  });

  test("UNLICENSED fails with an actionable diagnostic", () => {
    const v = evaluatePackage({ name: "x", version: "1.0.0", reportedLicense: "UNLICENSED" }, policy, [], TODAY);
    expect(v.allowed).toBe(false);
    expect(v.reason ?? "").toContain("not open source");
  });

  test("SEE LICENSE IN fails with a resolve-manually diagnostic", () => {
    const v = evaluatePackage({ name: "x", version: "1.0.0", reportedLicense: "SEE LICENSE IN LICENSE.txt" }, policy, [], TODAY);
    expect(v.allowed).toBe(false);
    expect(v.reason ?? "").toContain("SEE LICENSE IN");
  });
});



