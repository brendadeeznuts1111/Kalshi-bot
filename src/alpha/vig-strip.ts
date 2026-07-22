// @see https://bun.com/docs/test/index#run-tests
/** Pure vig removal — no I/O. */

export function americanToImplied(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`Invalid American odds: ${american}`);
  }
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

export function stripOverround(probs: number[]): number[] {
  if (!probs.length) throw new Error("stripOverround requires at least one probability");
  const total = probs.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("stripOverround total must be positive");
  return probs.map((p) => p / total);
}

export type AmericanSideOdds = { home: number; away: number; draw?: number };

export function impliedProbabilities(odds: AmericanSideOdds): number[] {
  const probs = [americanToImplied(odds.home), americanToImplied(odds.away)];
  if (odds.draw !== undefined) probs.push(americanToImplied(odds.draw));
  return stripOverround(probs);
}

export function impliedSideProbabilities(
  odds: AmericanSideOdds,
): { home: number; away: number; draw?: number } {
  const normalized = impliedProbabilities(odds);
  const out: { home: number; away: number; draw?: number } = {
    home: normalized[0]!,
    away: normalized[1]!,
  };
  if (odds.draw !== undefined && normalized[2] !== undefined) out.draw = normalized[2];
  return out;
}
