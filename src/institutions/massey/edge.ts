/**
 * Edge math: Massey-implied probability vs book line odds.
 *
 * edge = masseyImplied - lineImplied. Positive edge means the Massey model
 * prices the side stronger than the book does (value side, before vig).
 *
 * Odds formats: decimal (1.91), American (+110 / -110), implied (0.55).
 */

/** Implied probability from decimal odds: 1/odds. */
export function lineImpliedFromDecimal(decimalOdds: number): number | null {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return null;
  return 1 / decimalOdds;
}

/** Decimal odds from American odds: +110 -> 2.10, -110 -> 1.909. */
export function americanToDecimal(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}

/** American odds from decimal odds. */
export function decimalToAmerican(decimalOdds: number): number | null {
  const p = lineImpliedFromDecimal(decimalOdds);
  if (p == null) return null;
  if (p >= 0.5) return -Math.round((p / (1 - p)) * 100);
  return Math.round(((1 - p) / p) * 100);
}

export type MasseyEdge = {
  implied: number;
  lineImplied: number;
  edge: number;
  decimalOdds: number;
};

/**
 * Edge of a Massey-implied probability vs a decimal-odds line.
 * Returns null when inputs are unusable.
 */
export function masseyEdge(
  masseyImplied: number | null,
  decimalOdds: number,
): MasseyEdge | null {
  const lineImplied = lineImpliedFromDecimal(decimalOdds);
  if (masseyImplied == null || !Number.isFinite(masseyImplied) || lineImplied == null) {
    return null;
  }
  const edge = masseyImplied - lineImplied;
  return { implied: masseyImplied, lineImplied, edge, decimalOdds };
}

/**
 * Edge after removing a standard bookmaker overround (vig) from the line.
 * Both sides must be provided; returns null when the sum is not > 1.
 */
export function vigFreeEdge(
  masseyImplied: number | null,
  decimalOddsSide: number,
  decimalOddsOpponent: number,
): MasseyEdge | null {
  const p = lineImpliedFromDecimal(decimalOddsSide);
  const q = lineImpliedFromDecimal(decimalOddsOpponent);
  if (p == null || q == null || p + q <= 1) return null;
  const vigFree = p / (p + q);
  if (masseyImplied == null || !Number.isFinite(masseyImplied)) return null;
  return {
    implied: masseyImplied,
    lineImplied: vigFree,
    edge: masseyImplied - vigFree,
    decimalOdds: decimalOddsSide,
  };
}
