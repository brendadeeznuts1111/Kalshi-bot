/**
 * Shell settlement weighting + void-aware EV (plive ≡ ezlive).
 * @see docs/PLIVE-EZLIVE-SPORTS-RULES.md
 */

export {
  DEFAULT_WEIGHTING,
  classifyMarketClass,
  defaultVoidPrior,
  resolveSettlementWeighting,
  settlementComponents,
  tennisMatchMlWouldHaveAction,
  weightingSportKey,
  type SettlementContextInput,
  type SettlementMarketClass,
  type SettlementPhase,
  type SettlementWeighting,
  type SportWeightingRules,
  type VoidRiskLevel,
  type WeightingIndex,
  type WeightingSportKey,
} from './weighting.ts';

export {
  americanToDecimal,
  expectedValueWithVoid,
  type VoidEvInput,
  type VoidEvResult,
} from './void-ev.ts';

export {
  attachSettlementToComponents,
  describeSettlementWeighting,
  weightLiveTrackerMove,
  type LiveTrackerWeightInput,
  type LiveTrackerWeightResult,
} from './live-weight.ts';
