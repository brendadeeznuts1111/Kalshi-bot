import { describe, expect, test } from "bun:test";
import {
  asCurrencyCode,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  canonicalPolicySnapshot,
  computePolicyHash,
  type AuthorizationPolicy,
  verifyPolicyMatch,
} from "../../../src/partner/authorization/index.ts";

function policy(overrides: Partial<AuthorizationPolicy> = {}): AuthorizationPolicy {
  return {
    partnerCode: asPartnerCode("TEST"),
    outId: asOutId("out-TEST-1"),
    provider: asProviderId("test-provider"),
    skin: asSkinId("main"),
    scope: "live_trade",
    maxStake: 50_000,
    maxWin: 100_000,
    maxWinBasis: "profit",
    dailyLimit: 1_000_000,
    exposureLimit: 500_000,
    currency: asCurrencyCode("USD"),
    validFromMs: 1_700_000_000_000,
    expiresAtMs: 1_700_086_400_000,
    ...overrides,
  };
}

describe("authorization policy hash", () => {
  test("is deterministic and domain-separated", () => {
    const first = policy();
    const reordered = {
      expiresAtMs: first.expiresAtMs,
      maxWin: first.maxWin,
      partnerCode: first.partnerCode,
      currency: first.currency,
      outId: first.outId,
      provider: first.provider,
      skin: first.skin,
      scope: first.scope,
      maxStake: first.maxStake,
      maxWinBasis: first.maxWinBasis,
      dailyLimit: first.dailyLimit,
      exposureLimit: first.exposureLimit,
      validFromMs: first.validFromMs,
    } satisfies AuthorizationPolicy;

    const hash = computePolicyHash(first);
    expect(hash).toBe(computePolicyHash(reordered));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalPolicySnapshot(first).schema).toBe(
      "partner-account-authorization-policy-v1",
    );
  });

  test("binds limits, identity, scope, currency, and validity", () => {
    const original = policy();
    const hash = computePolicyHash(original);
    const mutations: AuthorizationPolicy[] = [
      policy({ maxStake: original.maxStake + 1 }),
      policy({ maxWin: original.maxWin + 1 }),
      policy({ outId: asOutId("out-TEST-2") }),
      policy({ scope: "paper_trade" }),
      policy({ currency: asCurrencyCode("EUR") }),
      policy({ expiresAtMs: original.expiresAtMs! + 1 }),
    ];

    for (const mutation of mutations) {
      expect(computePolicyHash(mutation)).not.toBe(hash);
      expect(verifyPolicyMatch(mutation, hash)).toBeFalse();
    }
    expect(verifyPolicyMatch(original, hash)).toBeTrue();
  });

  test("fails closed for malformed hashes and invalid policy values", () => {
    expect(verifyPolicyMatch(policy(), "not-a-hash")).toBeFalse();
    expect(() => computePolicyHash(policy({ maxStake: 1.5 }))).toThrow("minor units");
    expect(() =>
      computePolicyHash(policy({ expiresAtMs: 1_700_000_000_000 })),
    ).toThrow("later than validFromMs");
  });
});
