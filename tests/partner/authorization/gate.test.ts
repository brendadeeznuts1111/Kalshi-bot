import { describe, expect, test } from "bun:test";
import {
  asCurrencyCode,
  asAuthorizationId,
  asAuthorizationRequestId,
  asOutId,
  asPartnerCode,
  asProviderId,
  asSkinId,
  asTelegramChatId,
  asTelegramMessageId,
  asTelegramUserId,
  computePolicyHash,
  evaluateExecutionGate,
  type ApprovedAuthorization,
  type AuthorizationPolicy,
  type GateContext,
  type GateDenialCode,
} from "../../../src/partner/authorization/index.ts";

const NOW_MS = 1_700_000_000_000;

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
    validFromMs: NOW_MS - 60_000,
    expiresAtMs: NOW_MS + 60_000,
    ...overrides,
  };
}

function authorization(
  approvedPolicy = policy(),
  overrides: Partial<ApprovedAuthorization> = {},
): ApprovedAuthorization {
  return {
    id: asAuthorizationId(1),
    requestId: asAuthorizationRequestId(1),
    ...approvedPolicy,
    approvalHash: computePolicyHash(approvedPolicy),
    telegramChatId: asTelegramChatId("-123"),
    telegramTopicId: null,
    telegramMessageId: asTelegramMessageId("456"),
    approvingUserId: asTelegramUserId("789"),
    revokedAtMs: null,
    createdAtMs: NOW_MS - 60_000,
    updatedAtMs: NOW_MS - 60_000,
    ...overrides,
  };
}

function context(overrides: Partial<GateContext> = {}): GateContext {
  const currentPolicy = policy();
  return {
    authorization: authorization(currentPolicy),
    currentPolicy,
    nowMs: NOW_MS,
    oddsFresh: true,
    providerSessionValid: true,
    riskHealthy: true,
    stakeInput: {
      requestedStake: 1_000,
      sitePerBetMax: 10_000,
      decimalOdds: 2,
      availableBalance: 50_000,
      dailyUsed: 0,
      outstandingExposure: 0,
      marketLiquidity: 100_000,
    },
    ...overrides,
  };
}

function expectDenied(
  result: ReturnType<typeof evaluateExecutionGate>,
  code: GateDenialCode,
): void {
  expect(result.allowed).toBeFalse();
  if (!result.allowed) expect(result.code).toBe(code);
}

describe("execution authorization gate", () => {
  test("allows a verified request and returns the effective stake", () => {
    const result = evaluateExecutionGate(context());
    expect(result.allowed).toBeTrue();
    if (result.allowed) expect(result.effectiveStake).toBe(1_000);
    expect(Object.values(result.checks).every(Boolean)).toBeTrue();
  });

  test("rejects missing, revoked, future, and expired authorizations", () => {
    expectDenied(evaluateExecutionGate(context({ authorization: null })), "NO_AUTHORIZATION");
    expectDenied(
      evaluateExecutionGate(
        context({ authorization: authorization(policy(), { revokedAtMs: NOW_MS - 1 }) }),
      ),
      "AUTHORIZATION_REVOKED",
    );

    const future = policy({ validFromMs: NOW_MS + 1, expiresAtMs: NOW_MS + 60_000 });
    expectDenied(
      evaluateExecutionGate(context({ authorization: authorization(future), currentPolicy: future })),
      "AUTHORIZATION_NOT_YET_VALID",
    );

    const expired = policy({ validFromMs: NOW_MS - 60_000, expiresAtMs: NOW_MS });
    expectDenied(
      evaluateExecutionGate(
        context({ authorization: authorization(expired), currentPolicy: expired }),
      ),
      "AUTHORIZATION_EXPIRED",
    );
  });

  test("requires live-trade scope and an unchanged policy hash", () => {
    const paperPolicy = policy({ scope: "paper_trade" });
    expectDenied(
      evaluateExecutionGate(
        context({ authorization: authorization(paperPolicy), currentPolicy: paperPolicy }),
      ),
      "SCOPE_NOT_LIVE_TRADE",
    );

    expectDenied(
      evaluateExecutionGate(context({ currentPolicy: policy({ maxStake: 60_000 }) })),
      "POLICY_HASH_MISMATCH",
    );

    expectDenied(
      evaluateExecutionGate(
        context({ authorization: authorization(policy(), { maxStake: 60_000 }) }),
      ),
      "POLICY_HASH_MISMATCH",
    );
  });

  test("rejects each runtime health failure in fixed order", () => {
    expectDenied(evaluateExecutionGate(context({ oddsFresh: false })), "STALE_ODDS");
    expectDenied(
      evaluateExecutionGate(
        context({ stakeInput: { ...context().stakeInput, marketLiquidity: 0 } }),
      ),
      "EFFECTIVE_STAKE_NOT_POSITIVE",
    );
    expectDenied(
      evaluateExecutionGate(context({ providerSessionValid: false })),
      "PROVIDER_SESSION_INVALID",
    );
    expectDenied(evaluateExecutionGate(context({ riskHealthy: false })), "RISK_UNHEALTHY");
  });

  test("derives authorization limits from the hash-verified policy", () => {
    const limitedPolicy = policy({ maxStake: 250, dailyLimit: 300, exposureLimit: 400 });
    const result = evaluateExecutionGate(
      context({
        authorization: authorization(limitedPolicy),
        currentPolicy: limitedPolicy,
        stakeInput: {
          ...context().stakeInput,
          requestedStake: 10_000,
          dailyUsed: 25,
          outstandingExposure: 50,
        },
      }),
    );
    expect(result.allowed).toBeTrue();
    if (result.allowed) expect(result.effectiveStake).toBe(250);
  });
});
