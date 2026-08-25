/**
 * licenses-policy — pure license-policy logic for licenses:gate (§92/§93).
 * Kept dependency-free (no fs/network) so unit tests can exercise every
 * branch without spawning `bun pm`.
 *
 * Policy shape (config/licenses-allowlist.json):
 *   - allowedLicenses: canonical SPDX ids considered permissive.
 *   - licenseAliases: loose spellings normalized to a canonical id.
 *   - exemptions: name + optional license/version scope + optional
 *     expiry. An exemption applies ONLY while the reported license
 *     equals its scope (or any, if unset) — so a vendored package
 *     that later ships a real non-permissive license is caught
 *     automatically instead of staying grandfathered.
 */

export interface LicensePolicy {
  allowedLicenses: string[];
  licenseAliases: Record<string, string>;
}

export interface LicenseExemption {
  name: string;
  /** Only applies while the REPORTED license equals this (case-insensitive). */
  license?: string;
  /** Exact match on the resolved version when bun reports a semver. */
  version?: string;
  reason?: string;
  /** ISO date (YYYY-MM-DD). After it, the exemption FAILS the gate. */
  expires?: string;
}

export type AllowMatch = "allowlist" | "exemption" | null;

export interface EvaluatedPackage {
  name: string;
  version: string;
  reportedLicense: string;
  normalizedLicense: string;
  allowed: boolean;
  matchedBy: AllowMatch;
  reason?: string;
}

/**
 * Normalize a reported license string to a canonical SPDX id.
 * Order: exact allowed match -> exact alias -> case-insensitive alias
 * -> passthrough. Case-insensitive allowed lookup returns the canonical
 * form ("mit" -> "MIT", "apache-2.0" -> "Apache-2.0").
 */
export function normalizeLicense(raw: string, policy: LicensePolicy): string {
  const trimmed = raw.trim();
  const canon = policy.allowedLicenses.find((l) => l.toLowerCase() === trimmed.toLowerCase());
  if (canon) return canon;
  const exactAlias = policy.licenseAliases[trimmed];
  if (exactAlias) return exactAlias;
  const entry = Object.entries(policy.licenseAliases).find(
    ([key]) => key.toLowerCase() === trimmed.toLowerCase(),
  );
  return entry ? entry[1] : trimmed;
}

/**
 * Evaluate one package against the policy. `todayISO` defaults to the
 * caller-provided ISO date and drives expiry checks (expired exemption
 * -> NOT allowed, with an explicit reason).
 */
export function evaluatePackage(
  pkg: { name: string; version: string; reportedLicense: string },
  policy: LicensePolicy,
  exemptions: LicenseExemption[],
  todayISO: string,
): EvaluatedPackage {
  const base = { name: pkg.name, version: pkg.version, reportedLicense: pkg.reportedLicense };
  const normalized = normalizeLicense(pkg.reportedLicense, policy);
  const allowedSet = new Set(policy.allowedLicenses);
  if (allowedSet.has(normalized)) {
    return { ...base, normalizedLicense: normalized, allowed: true, matchedBy: "allowlist" };
  }
  const ex = exemptions.find(
    (e) =>
      e.name === pkg.name &&
      (!e.license || e.license.toLowerCase() === pkg.reportedLicense.trim().toLowerCase()) &&
      (!e.version || e.version === pkg.version),
  );
  if (ex) {
    if (ex.expires && ex.expires < todayISO) {
      return { ...base, normalizedLicense: normalized, allowed: false, matchedBy: null,
        reason: "exemption expired on " + ex.expires + " — re-review " + pkg.name + " (" + (ex.reason ?? "no reason recorded") + ")" };
    }
    return { ...base, normalizedLicense: normalized, allowed: true, matchedBy: "exemption",
      reason: (ex.reason ?? "exempted") + (ex.expires ? " (expires " + ex.expires + ")" : "") };
  }
  return { ...base, normalizedLicense: normalized, allowed: false, matchedBy: null,
    reason: "no allowlist entry and no matching exemption" };
}

/**
 * Exemptions that match no package in the current set — stale config
 * hygiene (warn, not fail: a dep may simply have been removed).
 */
export function findStaleExemptions(
  packages: { name: string }[],
  exemptions: LicenseExemption[],
): LicenseExemption[] {
  const names = new Set(packages.map((p) => p.name));
  return exemptions.filter((e) => !names.has(e.name));
}

/** Validate the loaded config shape; returns an error string or null. */
export function validatePolicyConfig(raw: unknown): string | null {
  const c = raw as { policy?: { allowedLicenses?: unknown; licenseAliases?: unknown }; exemptions?: unknown };
  if (!c || typeof c !== "object") return "config root must be an object";
  const allowed = c.policy?.allowedLicenses;
  if (!Array.isArray(allowed) || allowed.length === 0) return "policy.allowedLicenses must be a non-empty array";
  for (const l of allowed) if (typeof l !== "string" || !l.trim()) return "policy.allowedLicenses entries must be non-empty strings";
  const aliases = c.policy?.licenseAliases;
  if (aliases !== undefined && (typeof aliases !== "object" || Array.isArray(aliases))) return "policy.licenseAliases must be an object";
  const ex = c.exemptions;
  if (ex !== undefined) {
    if (!Array.isArray(ex)) return "exemptions must be an array";
    for (const e of ex as LicenseExemption[]) {
      if (!e || typeof e.name !== "string" || !e.name) return "each exemption needs a non-empty name";
      if (e.license !== undefined && typeof e.license !== "string") return "exemption.license must be a string";
      if (e.version !== undefined && typeof e.version !== "string") return "exemption.version must be a string";
      if (e.expires !== undefined && (typeof e.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires)))
        return "exemption.expires must be an ISO date (YYYY-MM-DD)";
    }
  }
  return null;
}
