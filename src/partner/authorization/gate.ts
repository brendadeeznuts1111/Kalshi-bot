import type {
  ApprovedAuthorization,
  AuthorizationPolicy,
  GateChecks,
  GateDecision,
  GateDenialCode,
  GateStakeInput,
} from "./domain.ts";
import { policyFromAuthorization } from "./domain.ts";
import { verifyPolicyMatch } from "./hash.ts";
import { computeEffectiveStake } from "./stake.ts";

export interface GateContext {
  authorization: ApprovedAuthorization | null;
  currentPolicy: AuthorizationPolicy;
  nowMs: number;
  oddsFresh: boolean;
  providerSessionValid: boolean;
  riskHealthy: boolean;
  stakeInput: GateStakeInput;
}

function initialChecks(): GateChecks {
  return {
    hasActiveAuthorization: false,
    isScopeLiveTrade: false,
    hashMatch: false,
    oddsFresh: false,
    effectiveStakePositive: false,
    providerSessionValid: false,
    riskHealthy: false,
  };
}

function denied(
  code: GateDenialCode,
  reason: string,
  checks: GateChecks,
): GateDecision {
  return { allowed: false, code, reason, checks };
}

/** Pure, deterministic, fail-closed authorization decision. No reservation or placement occurs. */
export function evaluateExecutionGate(context: GateContext): GateDecision {
  const checks = initialChecks();
  const auth = context.authorization;

  if (auth === null) {
    return denied("NO_AUTHORIZATION", "No authorization was supplied", checks);
  }
  if (!Number.isSafeInteger(context.nowMs) || context.nowMs < 0) {
    return denied(
      "INVALID_EVALUATION_TIME",
      "Authorization evaluation time is invalid",
      checks,
    );
  }
  if (auth.revokedAtMs !== null) {
    return denied("AUTHORIZATION_REVOKED", "Authorization has been revoked", checks);
  }
  if (context.nowMs < auth.validFromMs) {
    return denied(
      "AUTHORIZATION_NOT_YET_VALID",
      "Authorization validity period has not started",
      checks,
    );
  }
  if (auth.expiresAtMs !== null && context.nowMs >= auth.expiresAtMs) {
    return denied("AUTHORIZATION_EXPIRED", "Authorization has expired", checks);
  }
  checks.hasActiveAuthorization = true;

  if (auth.scope !== "live_trade") {
    return denied("SCOPE_NOT_LIVE_TRADE", `Scope is ${auth.scope}, not live_trade`, checks);
  }
  checks.isScopeLiveTrade = true;

  if (
    !verifyPolicyMatch(policyFromAuthorization(auth), auth.approvalHash) ||
    !verifyPolicyMatch(context.currentPolicy, auth.approvalHash)
  ) {
    return denied(
      "POLICY_HASH_MISMATCH",
      "Policy hash mismatch: authorization terms changed",
      checks,
    );
  }
  checks.hashMatch = true;

  if (!context.oddsFresh) {
    return denied("STALE_ODDS", "Odds are stale", checks);
  }
  checks.oddsFresh = true;

  const effectiveStake = computeEffectiveStake({
    ...context.stakeInput,
    partnerApprovedMaxStake: context.currentPolicy.maxStake,
    maxWin: context.currentPolicy.maxWin,
    maxWinBasis: context.currentPolicy.maxWinBasis,
    dailyLimit: context.currentPolicy.dailyLimit,
    exposureLimit: context.currentPolicy.exposureLimit,
  });
  if (effectiveStake <= 0) {
    return denied(
      "EFFECTIVE_STAKE_NOT_POSITIVE",
      "Effective stake is not positive",
      checks,
    );
  }
  checks.effectiveStakePositive = true;

  if (!context.providerSessionValid) {
    return denied(
      "PROVIDER_SESSION_INVALID",
      "Provider session is expired or invalid",
      checks,
    );
  }
  checks.providerSessionValid = true;

  if (!context.riskHealthy) {
    return denied("RISK_UNHEALTHY", "Global risk health check failed", checks);
  }
  checks.riskHealthy = true;

  return { allowed: true, effectiveStake, checks };
}
