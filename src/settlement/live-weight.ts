/**
 * Wire settlement weighting + sport-wide edge patterns into live-tracker / signals.
 */
import {
  scanEdgePatterns,
  type EdgePatternHit,
  type EdgePatternScanResult,
  type EdgePatternSortOptions,
} from './edge-patterns.ts';
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

/** Merge settlement + edge-pattern scan into components. */
export function attachEdgePatternComponents(
  components: Record<string, number>,
  scan: EdgePatternScanResult,
): Record<string, number> {
  return {
    ...components,
    ...settlementComponents(scan.settlement),
    ...scan.components,
  };
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
  /** Override void prior; default from voidRisk / pattern max. */
  pVoid?: number;
  stake?: number;
  matchState?: {
    firstSetCompleted?: boolean;
    matchCompleted?: boolean;
    periodCompleted?: boolean;
    minute?: number;
    injuryRisk?: boolean;
    eligibilityBroken?: boolean;
  };
  /** Run full edge-pattern scan (default true). */
  scanPatterns?: boolean;
  /** Hit order: family | severity | id (comma-separated via parseEdgePatternSortBy). */
  patternSort?: EdgePatternSortOptions;
};

export type LiveTrackerWeightResult = {
  weighting: SettlementWeighting;
  summary: string;
  pVoidPrior: number;
  /** Present when odds supplied */
  voidEv: VoidEvResult | null;
  /** Skip / size note for desk */
  sizingNote: string;
  /** Sport-wide pattern hits (void, OT, eligibility, …) */
  patterns: EdgePatternHit[];
  patternScan: EdgePatternScanResult | null;
  eyeOpeners: string[];
};

/**
 * Annotate a live-tracker PRICE_CHANGE (or any priced move) with settlement
 * context + convergent edge patterns (sport / market / line).
 */
export function weightLiveTrackerMove(input: LiveTrackerWeightInput): LiveTrackerWeightResult {
  const weighting = resolveSettlementWeighting({
    sportId: input.sportId,
    phase: input.phase,
    marketType: input.marketType,
    period: input.period,
    matchState: input.matchState,
  });

  const scanPatterns = input.scanPatterns !== false;
  const patternScan = scanPatterns
    ? scanEdgePatterns(
        {
          sportId: input.sportId,
          phase: input.phase,
          marketType: input.marketType,
          period: input.period,
          decimalOdds: input.decimalOdds,
          matchState: input.matchState,
          settlement: weighting,
        },
        input.patternSort ?? {},
      )
    : null;

  const patternVoid = patternScan
    ? Math.max(
        0,
        ...patternScan.hits.map(h => h.components.pat_void_prior ?? 0),
      )
    : 0;
  const pVoidPrior =
    input.pVoid ?? Math.max(defaultVoidPrior(weighting.voidRisk), patternVoid);
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
    const abs = Math.abs(voidEv.voidDelta).toFixed(2);
    sizingNote +=
      voidEv.voidDelta < 0
        ? ` · two-way understates holder EV by ~${abs} (voids refund)`
        : ` · two-way overstates holder EV by ~${abs} vs void model`;
  }

  const eyeOpeners = patternScan?.eyeOpeners ?? [];
  if (eyeOpeners.length) {
    sizingNote += ` · patterns: ${patternScan!.hits
      .filter(h => h.severity === 'high' || h.severity === 'critical')
      .map(h => h.patternId)
      .join(', ') || patternScan!.hits[0]?.patternId}`;
  }

  return {
    weighting,
    summary: describeSettlementWeighting(weighting),
    pVoidPrior,
    voidEv,
    sizingNote,
    patterns: patternScan?.hits ?? [],
    patternScan,
    eyeOpeners,
  };
}
