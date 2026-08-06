import type { AuthorizationPolicy, PolicyHash } from "./domain.ts";
import { asPolicyHash, POLICY_HASH_DOMAIN } from "./domain.ts";

export type CanonicalPolicySnapshot = Readonly<{
  schema: typeof POLICY_HASH_DOMAIN;
  partnerCode: AuthorizationPolicy["partnerCode"];
  outId: AuthorizationPolicy["outId"];
  provider: AuthorizationPolicy["provider"];
  skin: AuthorizationPolicy["skin"];
  scope: AuthorizationPolicy["scope"];
  maxStake: number;
  maxWin: number;
  maxWinBasis: AuthorizationPolicy["maxWinBasis"];
  dailyLimit: number | null;
  exposureLimit: number | null;
  currency: AuthorizationPolicy["currency"];
  validFromMs: number;
  expiresAtMs: number | null;
}>;

function assertMinorUnits(value: number | null, field: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`${field} must be a non-negative safe integer in minor units`);
  }
}

function assertTimestamp(value: number | null, field: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError(`${field} must be a non-negative epoch-millisecond integer`);
  }
}

export function canonicalPolicySnapshot(policy: AuthorizationPolicy): CanonicalPolicySnapshot {
  assertMinorUnits(policy.maxStake, "maxStake");
  assertMinorUnits(policy.maxWin, "maxWin");
  assertMinorUnits(policy.dailyLimit, "dailyLimit");
  assertMinorUnits(policy.exposureLimit, "exposureLimit");
  assertTimestamp(policy.validFromMs, "validFromMs");
  assertTimestamp(policy.expiresAtMs, "expiresAtMs");
  if (policy.expiresAtMs !== null && policy.expiresAtMs <= policy.validFromMs) {
    throw new TypeError("expiresAtMs must be later than validFromMs");
  }

  // Explicit field order is the serialized contract. Never hash the source object directly.
  return Object.freeze({
    schema: POLICY_HASH_DOMAIN,
    partnerCode: policy.partnerCode,
    outId: policy.outId,
    provider: policy.provider,
    skin: policy.skin,
    scope: policy.scope,
    maxStake: policy.maxStake,
    maxWin: policy.maxWin,
    maxWinBasis: policy.maxWinBasis,
    dailyLimit: policy.dailyLimit,
    exposureLimit: policy.exposureLimit,
    currency: policy.currency,
    validFromMs: policy.validFromMs,
    expiresAtMs: policy.expiresAtMs,
  });
}

export function computePolicyHash(policy: AuthorizationPolicy): PolicyHash {
  const serialized = JSON.stringify(canonicalPolicySnapshot(policy));
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(serialized);
  return asPolicyHash(hasher.digest("hex"));
}

export function verifyPolicyMatch(policy: AuthorizationPolicy, storedHash: string): boolean {
  let expected: PolicyHash;
  let actual: PolicyHash;
  try {
    expected = computePolicyHash(policy);
    actual = asPolicyHash(storedHash);
  } catch {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) {
    mismatch |= expected.charCodeAt(index) ^ actual.charCodeAt(index);
  }
  return mismatch === 0;
}
