/**
 * Wire settlement weighting into live-tracker / signal components.
 */
import {
  defaultVoidPrior,
  resolveSettlementWeighting,
  settlementComponents,
  type SettlementPhase,
  type SettlementWeighting,
} from './weighting.ts';
import { americanToDecimal, expectedValueWithVoid, type VoidEvResult } from './void-ev.ts';

export function describeSettlementWeighting(w: SettlementWeighting): string {
  const parts = [
    w.sportKey ?? 'unknown_sport',
    w.phase,
    w.marketClass,
    `action=${w.actionThreshold}`,
    `voidRisk=${w.voidRisk}`,
  ];
  if (w.preferCompletedUnitMarkets) parts.push('prefer_unit_mkts');
  if (w.tennisRetirement?.wouldHaveAction != null) {
    parts.push(`wouldAction=${w.tennisRetirement.wouldHaveAction}`);
  }
  return parts.join(' · ');
}

/** Merge settlement numeric tags into SignalContext.components. */
export function attachSettlementToComponents(
  components: Record<string, number>,
  w: SettlementWeighting,
): Record<string, number> {
  return { ...components, ...settlementComponents(w) };
}

export type LiveTrackerWeightInput = {
  sportId: string;
  phase: SettlementPhase;
  marketType?: string | null;
  period?: string | null;
  /** Decimal odds after the move (optional — for EV sketch). */
  decimalOdds?: number | null;
  /** American odds if decimal not given. */
  americanOdds?: number | null;
  /** Model win prob; default 0.5 for illustration only. */
  pWin?: number;
  /** Override void prior; default from voidRisk. */
  pVoid?: number;
  stake?: number;
  matchState?: {
    firstSetCompleted?: boolean;
    matchCompleted?: boolean;
    periodCompleted?: boolean;
  };
};

export type LiveTrackerWeightResult = {
  weighting: SettlementWeighting;
  summary: string;
  pVoidPrior: number;
  /** Present when odds supplied */
  voidEv: VoidEvResult | null;
  /** Skip / size note for desk */
  sizingNote: string;
};

/**
 * Annotate a live-tracker PRICE_CHANGE (or any priced move) with settlement context.
 */
export function weightLiveTrackerMove(input: LiveTrackerWeightInput): LiveTrackerWeightResult {
  const weighting = resolveSettlementWeighting({
    sportId: input.sportId,
    phase: input.phase,
    marketType: input.marketType,
    period: input.period,
    matchState: input.matchState,
  });
  const pVoidPrior = input.pVoid ?? defaultVoidPrior(weighting.voidRisk);
  const pWin = input.pWin ?? 0.5;
  const stake = input.stake ?? 100;

  let decimal = input.decimalOdds ?? null;
  if ((decimal == null || !Number.isFinite(decimal)) && input.americanOdds != null) {
    decimal = americanToDecimal(input.americanOdds);
  }

  let voidEv: VoidEvResult | null = null;
  if (decimal != null && Number.isFinite(decimal) && decimal > 1) {
    voidEv = expectedValueWithVoid({
      pWin,
      pVoid: pVoidPrior,
      stake,
      decimalOdds: decimal,
    });
  }

  let sizingNote = 'size residual action path only';
  if (weighting.preferCompletedUnitMarkets) {
    sizingNote =
      'live match ML: high void on unfinished match — prefer completed set/game markets';
  } else if (weighting.voidRisk === 'high') {
    sizingNote = 'high void risk — use three-way EV; do not treat mid as pure p_win';
  } else if (weighting.voidRisk === 'low') {
    sizingNote = 'low void risk under current phase/class';
  }

  if (voidEv && Math.abs(voidEv.voidDelta) > 0.01 * stake) {
    // voidDelta = twoWayEv - threeWayEv; negative ⇒ two-way understates holder EV (voids help)
    const abs = Math.abs(voidEv.voidDelta).toFixed(2);
    sizingNote +=
      voidEv.voidDelta < 0
        ? ` · two-way understates holder EV by ~${abs} (voids refund)`
        : ` · two-way overstates holder EV by ~${abs} vs void model`;
  }

  return {
    weighting,
    summary: describeSettlementWeighting(weighting),
    pVoidPrior,
    voidEv,
    sizingNote,
  };
}
