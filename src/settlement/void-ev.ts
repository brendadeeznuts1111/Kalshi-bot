/**
 * Three-way EV (win / lose / void-refund) for shell books and phase-aware sizing.
 *
 * EV = p_win*(s*o) + p_void*s + p_lose*0 - s
 */

export type VoidEvInput = {
  /** Probability of win (selection grades as winner). */
  pWin: number;
  /** Probability of void / no-action refund. */
  pVoid: number;
  /**
   * Probability of lose. If omitted: max(0, 1 - pWin - pVoid).
   * If provided, need not sum to 1 (overround-style); residual ignored.
   */
  pLose?: number;
  /** Stake (currency units). */
  stake: number;
  /** Decimal odds (e.g. 1.91). American -110 ≈ 1.909. */
  decimalOdds: number;
};

export type VoidEvResult = {
  pWin: number;
  pVoid: number;
  pLose: number;
  stake: number;
  decimalOdds: number;
  /** Expected cash after settle (includes refund on void). */
  expectedCash: number;
  /** expectedCash - stake */
  ev: number;
  /** EV / stake */
  edge: number;
  /** Two-way EV ignoring void (p_void folded into lose) — for contrast. */
  twoWayEv: number;
  /** twoWayEv - ev: how much void branch changes the number */
  voidDelta: number;
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function expectedValueWithVoid(input: VoidEvInput): VoidEvResult {
  const pWin = clamp01(input.pWin);
  const pVoid = clamp01(input.pVoid);
  const pLose =
    input.pLose != null ? clamp01(input.pLose) : clamp01(1 - pWin - pVoid);
  const stake = input.stake;
  const o = input.decimalOdds;

  if (!(stake > 0) || !(o > 1)) {
    return {
      pWin,
      pVoid,
      pLose,
      stake,
      decimalOdds: o,
      expectedCash: stake,
      ev: 0,
      edge: 0,
      twoWayEv: 0,
      voidDelta: 0,
    };
  }

  const expectedCash = pWin * (stake * o) + pVoid * stake + pLose * 0;
  const ev = expectedCash - stake;
  // Two-way: treat void as lose (common false model)
  const twoWayCash = pWin * (stake * o) + (1 - pWin) * 0;
  const twoWayEv = twoWayCash - stake;

  return {
    pWin,
    pVoid,
    pLose,
    stake,
    decimalOdds: o,
    expectedCash,
    ev,
    edge: ev / stake,
    twoWayEv,
    voidDelta: twoWayEv - ev,
  };
}

/**
 * American odds → decimal. e.g. -110 → 1.909…, +150 → 2.5
 */
export function americanToDecimal(american: number): number {
  if (!Number.isFinite(american) || american === 0) return NaN;
  if (american > 0) return 1 + american / 100;
  return 1 + 100 / Math.abs(american);
}
