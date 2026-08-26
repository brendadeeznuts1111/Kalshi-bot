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
  /** Warn (not fail) when an exemption expires within this many days. Default 30. */
  expiryWarningDays?: number;
}

export interface LicenseExemption {
  name: string;
  /** Only applies while the REPORTED license equals this (case-insensitive). */
  license?: string;
  /** Exact match on the resolved version when bun reports a semver. */
  version?: string;
  reason?: string;
  /** Concrete next action printed when the exemption expires (e.g. contact legal, upgrade to v2). */
  remediation?: string;
  /** ISO date (YYYY-MM-DD). After it, the exemption FAILS the gate. */
  expires?: string;
}

export type AllowMatch = "allowlist" | "exemption" | "expression" | null;

export interface EvaluatedPackage {
  name: string;
  version: string;
  reportedLicense: string;
  normalizedLicense: string;
  allowed: boolean;
  matchedBy: AllowMatch;
  reason?: string;
  /** ISO expiry when allowed via an exemption with an expiry. */
  expires?: string;
  /** Whole days from today until expiry (only when allowed via exemption). */
  expiresInDays?: number;
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
        reason: "exemption expired on " + ex.expires + " — re-review " + pkg.name + " (" + (ex.reason ?? "no reason recorded") + ")" + (ex.remediation ? " Action: " + ex.remediation : "") };
    }
    const expiresInDays = ex.expires ? wholeDaysBetween(todayISO, ex.expires) : undefined;
    return { ...base, normalizedLicense: normalized, allowed: true, matchedBy: "exemption",
      reason: (ex.reason ?? "exempted") + (ex.expires ? " (expires " + ex.expires + ")" : ""),
      ...(ex.expires ? { expires: ex.expires } : {}),
      ...(expiresInDays !== undefined ? { expiresInDays } : {}) };
  }
  const expr = evaluateLicenseExpression(pkg.reportedLicense, policy);
  if (expr.allowed) {
    return { ...base, normalizedLicense: expr.normalized, allowed: true, matchedBy: "expression" };
  }
  if (expr.isExpression) {
    return { ...base, normalizedLicense: expr.normalized, allowed: false, matchedBy: null,
      reason: "SPDX expression has no permissive alternative: " + expr.normalized };
  }
  const rawTrimmed = pkg.reportedLicense.trim();
  if (/^UNLICENSED$/i.test(rawTrimmed)) {
    return { ...base, normalizedLicense: normalized, allowed: false, matchedBy: null,
      reason: "UNLICENSED — not open source; remove the dep or get an explicit vendor/legal exemption" };
  }
  if (/^SEE LICENSE IN\b/i.test(rawTrimmed)) {
    return { ...base, normalizedLicense: normalized, allowed: false, matchedBy: null,
      reason: "SEE LICENSE IN <file> — license deferred to a file; resolve manually and add an exemption" };
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
  const c = raw as { policy?: { allowedLicenses?: unknown; licenseAliases?: unknown; expiryWarningDays?: unknown }; exemptions?: unknown };
  if (!c || typeof c !== "object") return "config root must be an object";
  const allowed = c.policy?.allowedLicenses;
  if (!Array.isArray(allowed) || allowed.length === 0) return "policy.allowedLicenses must be a non-empty array";
  for (const l of allowed) if (typeof l !== "string" || !l.trim()) return "policy.allowedLicenses entries must be non-empty strings";
  const aliases = c.policy?.licenseAliases;
  if (aliases !== undefined && (typeof aliases !== "object" || Array.isArray(aliases))) return "policy.licenseAliases must be an object";
  const warnDays = c.policy?.expiryWarningDays;
  if (warnDays !== undefined && (typeof warnDays !== "number" || !Number.isInteger(warnDays) || warnDays < 0)) return "policy.expiryWarningDays must be a non-negative integer";
  const ex = c.exemptions;
  if (ex !== undefined) {
    if (!Array.isArray(ex)) return "exemptions must be an array";
    for (const e of ex as LicenseExemption[]) {
      if (!e || typeof e.name !== "string" || !e.name) return "each exemption needs a non-empty name";
      if (e.license !== undefined && typeof e.license !== "string") return "exemption.license must be a string";
      if (e.version !== undefined && typeof e.version !== "string") return "exemption.version must be a string";
      if (e.expires !== undefined && (typeof e.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.expires)))
        return "exemption.expires must be an ISO date (YYYY-MM-DD)";
      if (e.remediation !== undefined && typeof e.remediation !== "string") return "exemption.remediation must be a string";
    }
  }
  return null;
}

/** Whole days from `fromISO` to `toISO` (ISO dates, UTC-based). */
export function wholeDaysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO + "T00:00:00Z");
  const to = Date.parse(toISO + "T00:00:00Z");
  return Math.round((to - from) / 86_400_000);
}

export interface ExpressionResult {
  /** True when the raw string is a compound SPDX expression (OR/AND/parens). */
  isExpression: boolean;
  /** Whether the expression has at least one permissive compliance path. */
  allowed: boolean;
  normalized: string;
}

/**
 * Split on `op` only at parenthesis depth 0 (word-boundary, case-sensitive —
 * lowercase 'or' in 'GPL-2.0-or-later' is NOT an operator).
 */
function splitTopLevel(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      const before = i > 0 ? (expr[i - 1] ?? " ") : " ";
      const after = expr[i + op.length] ?? " ";
      if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) {
        parts.push(current.trim());
        current = "";
        i += op.length - 1;
        continue;
      }
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

/**
 * Evaluate a compound SPDX license expression against the allowlist.
 * Semantics: OR -> allowed if ANY alternative is allowed (the licensee may
 * comply with the allowed one); AND -> allowed only if ALL are allowed.
 * Parentheses nest; bare operands fall through to normalizeLicense.
 * Non-expression strings return { isExpression: false, allowed: false } so
 * callers can fall through to the plain allowlist path.
 */
/** Recursive evaluation of an expression (operands are leaf-normalized). */
function expressionAllows(expr: string, policy: LicensePolicy, allowedSet: Set<string>): boolean {
  let e = expr.trim();
  while (e.startsWith("(") && e.endsWith(")")) e = e.slice(1, -1).trim();
  const orParts = splitTopLevel(e, "OR");
  if (orParts.length > 1) return orParts.some((p) => expressionAllows(p, policy, allowedSet));
  const andParts = splitTopLevel(e, "AND");
  if (andParts.length > 1) return andParts.every((p) => expressionAllows(p, policy, allowedSet));
  const withParts = splitTopLevel(e, "WITH");
  if (withParts.length > 1) {
    // SPDX exception modifier (e.g. GPL-2.0 WITH Classpath-exception-2.0):
    // permissiveness is decided by the BASE license — an exception never
    // makes a non-permissive license permissive for our allowlist purposes.
    return expressionAllows(withParts[0]!, policy, allowedSet);
  }
  const operand = normalizeLicense(e, policy);
  return allowedSet.has(operand.toLowerCase());
}

export function evaluateLicenseExpression(raw: string, policy: LicensePolicy): ExpressionResult {
  const trimmed = raw.trim();
  const isExpression = /[()]/.test(trimmed) || /\bOR\b/.test(trimmed) || /\bAND\b/.test(trimmed) || /\bWITH\b/.test(trimmed);
  if (!isExpression) return { isExpression: false, allowed: false, normalized: trimmed };
  const allowedSet = new Set(policy.allowedLicenses.map((l) => l.toLowerCase()));
  return { isExpression: true, allowed: expressionAllows(trimmed, policy, allowedSet), normalized: trimmed };
}

/**
 * Offline vulnerability overlay (§94) — a STATIC map of pkg@version to a
 * severity, refreshed by `bun run audit:overlay:update` (network allowed
 * there, never in the gate). The license gate WARNs on matches but never
 * changes its exit code — license policy stays the merge authority.
 */
export interface AuditAdvisory {
  severity: "critical" | "high" | "medium" | "low" | string;
  note?: string;
}

export interface AuditOverlay {
  advisories: Record<string, AuditAdvisory>;
}

/**
 * Validate config/audit-overrides.json. Accepts either
 * { "pkg@version": { severity, note? } } or the shorthand
 * { "pkg@version": "high" }. Returns an error string or null.
 */
export function validateAuditOverrides(raw: unknown): string | null {
  const c = raw as { advisories?: unknown } | Record<string, unknown>;
  if (!c || typeof c !== "object") return "audit-overrides root must be an object";
  const advisories = (c as { advisories?: unknown }).advisories ?? c;
  if (typeof advisories !== "object" || Array.isArray(advisories)) return "advisories must be an object of pkg@version entries";
  for (const [key, val] of Object.entries(advisories as Record<string, unknown>)) {
    if (!key.includes("@")) return "advisory key must be pkg@version (got: " + key + ")";
    if (typeof val === "string") continue; // shorthand severity
    const o = val as { severity?: unknown; note?: unknown };
    if (!o || typeof o !== "object" || typeof o.severity !== "string" || !o.severity)
      return "advisory entry must be a severity string or { severity, note? } (key: " + key + ")";
    if (o.note !== undefined && typeof o.note !== "string") return "advisory note must be a string (key: " + key + ")";
  }
  return null;
}

/** Normalize a validated overlay into { pkg@version: { severity, note? } }. */
export function normalizeAuditOverlay(raw: unknown): AuditOverlay {
  const advisories = (raw as { advisories?: Record<string, unknown> })?.advisories ?? (raw as Record<string, unknown>);
  const out: Record<string, AuditAdvisory> = {};
  for (const [key, val] of Object.entries(advisories)) {
    if (typeof val === "string") { out[key] = { severity: val }; continue; }
    const o = val as { severity: string; note?: string };
    out[key] = { severity: o.severity, ...(o.note ? { note: o.note } : {}) };
  }
  return { advisories: out };
}

/** Look up an advisory for name@version (version may be a file spec for file: deps). */
export function advisoryFor(name: string, version: string, overlay: AuditOverlay): AuditAdvisory | null {
  return overlay.advisories[name + "@" + version] ?? null;
}
