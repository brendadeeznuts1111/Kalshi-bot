/**
 * Odds format helpers aligned with Fantasy Ultra widget:
 *   oddsFormat: "american"
 *   roundUSOddsDown: true
 *   oddsDecimalPlaces: 3
 */

export type OddsFormat = "american" | "decimal";

export type DualOdds = {
  decimal: number;
  american: number;
  format: OddsFormat;
};

/** American → decimal. +150 → 2.5; -200 → 1.5 */
export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`invalid american odds: ${american}`);
  }
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

/**
 * Decimal → American (unrounded).
 * ≥2.0 → positive; (1,2) → negative. Exactly 2.0 → +100.
 */
export function decimalToAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) {
    throw new Error(`invalid decimal odds: ${decimal}`);
  }
  if (decimal >= 2) return (decimal - 1) * 100;
  return -100 / (decimal - 1);
}

/**
 * roundUSOddsDown: round American odds against the bettor.
 * Positive: floor (+110.9 → +110). Negative: floor toward −∞ (−110.1 → −111).
 */
export function roundUsOddsDown(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`invalid american odds: ${american}`);
  }
  return Math.floor(american);
}

/** Truncate decimal to N places (widget oddsDecimalPlaces: 3). */
export function truncateDecimal(decimal: number, places = 3): number {
  if (!Number.isFinite(decimal)) throw new Error(`invalid decimal: ${decimal}`);
  const f = 10 ** places;
  return Math.trunc(decimal * f) / f;
}

/**
 * Normalize a price to dual form using widget policy.
 */
export function normalizeOdds(
  value: number,
  format: OddsFormat,
  options: { roundUsDown?: boolean; decimalPlaces?: number } = {},
): DualOdds {
  const roundUsDown = options.roundUsDown !== false;
  const decimalPlaces = options.decimalPlaces ?? 3;

  if (format === "american") {
    const american = roundUsDown ? roundUsOddsDown(value) : Math.round(value);
    const decimal = truncateDecimal(americanToDecimal(american), decimalPlaces);
    return { decimal, american, format };
  }

  let american = decimalToAmerican(value);
  if (roundUsDown) american = roundUsOddsDown(american);
  else american = Math.round(american);
  const decimal = truncateDecimal(americanToDecimal(american), decimalPlaces);
  return { decimal, american, format };
}
