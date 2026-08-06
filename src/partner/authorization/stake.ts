import type { StakeComputationInput } from "./domain.ts";

function isMinorUnits(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validMoneyInputs(input: StakeComputationInput): boolean {
  const required = [
    input.requestedStake,
    input.sitePerBetMax,
    input.partnerApprovedMaxStake,
    input.maxWin,
    input.availableBalance,
    input.dailyUsed,
    input.outstandingExposure,
    input.marketLiquidity,
  ];
  return (
    required.every(isMinorUnits) &&
    (input.dailyLimit === null || isMinorUnits(input.dailyLimit)) &&
    (input.exposureLimit === null || isMinorUnits(input.exposureLimit))
  );
}

/**
 * Compute the largest permitted integer stake in minor units.
 * Invalid, unknown, exhausted, or non-executable inputs fail closed to zero.
 */
export function computeEffectiveStake(input: StakeComputationInput): number {
  if (!validMoneyInputs(input) || !Number.isFinite(input.decimalOdds)) return 0;
  if (input.decimalOdds <= 1) return 0;
  if (input.maxWinBasis !== "profit" && input.maxWinBasis !== "total_return") return 0;

  const denominator = input.maxWinBasis === "profit" ? input.decimalOdds - 1 : input.decimalOdds;
  let maxWinStake = Math.floor(input.maxWin / denominator);
  if (!Number.isSafeInteger(maxWinStake) || maxWinStake < 0) return 0;
  // IEEE-754 division can land exactly on an integer while multiplication lands just above it.
  // Step down once when necessary so the computed win never exceeds the approved cap.
  if (maxWinStake > 0 && maxWinStake * denominator > input.maxWin) {
    maxWinStake -= 1;
  }

  let effective = Math.min(
    input.requestedStake,
    input.sitePerBetMax,
    input.partnerApprovedMaxStake,
    maxWinStake,
    input.availableBalance,
    input.marketLiquidity,
  );

  if (input.dailyLimit !== null) {
    effective = Math.min(effective, input.dailyLimit - input.dailyUsed);
  }
  if (input.exposureLimit !== null) {
    effective = Math.min(effective, input.exposureLimit - input.outstandingExposure);
  }

  return Math.max(Math.floor(effective), 0);
}
