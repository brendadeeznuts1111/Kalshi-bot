/**
 * Tennis game-model causal circuit contract.
 *
 * This is deliberately a data-policy contract, not a tuning surface. Numeric
 * model parameters remain in their owning modules. Any proposed parameter
 * change needs causal evidence from the trading corpus and a new backtest; UI,
 * transport, cache, and timing diagnostics may be logged but cannot become
 * pModel components by accident.
 */

export const MODEL_INPUT_COMPONENTS = [
  'self_prior',
  'strength_yes',
  'strength_no',
  'hold_prob_yes',
  'hold_prob_no',
] as const;

export const MATCH_STATE_COMPONENTS = [
  'live',
  'set_delta',
  'game_delta',
] as const;

export const MODEL_DIAGNOSTIC_COMPONENTS = [
  'players_known',
  'model_kind',
  'match_win_prob',
] as const;

/** Market values are recorded to explain an execution decision, never blended into pModel. */
export const DECISION_OBSERVATION_COMPONENTS = [
  'market_opening_prior',
  'market_mid_current',
] as const;

export const PERMITTED_SIGNAL_COMPONENTS = [
  ...MODEL_INPUT_COMPONENTS,
  ...MATCH_STATE_COMPONENTS,
  ...MODEL_DIAGNOSTIC_COMPONENTS,
  ...DECISION_OBSERVATION_COMPONENTS,
] as const;

export type TennisGameModelComponent = (typeof PERMITTED_SIGNAL_COMPONENTS)[number];
/**
 * A component map stays open in TypeScript so consumers can inspect values by
 * string key. Runtime admission is intentionally closed by
 * assertPermittedSignalComponents before the map crosses a model boundary.
 */
export type TennisGameModelComponents = Record<string, number>;

/** Inputs that can be measured but are intentionally excluded from pModel. */
export const EXCLUDED_NOISE_FIELDS = [
  'latency_ms',
  'network_latency_ms',
  'transport',
  'source_clock',
  'book_sequence',
  'cache_age_ms',
  'render_latency_ms',
  'ui_state',
  'fetch_attempt',
] as const;

export const TENNIS_GAME_MODEL_ENVIRONMENT = {
  executionArm: ['ALPHA_LIVE'],
  rule: 'ALPHA_LIVE only permits an already-approved live route when it exactly matches the program name; it never changes pModel or weights.',
} as const;

export const TENNIS_GAME_MODEL_PROPERTY_GROUPS = [
  {
    id: 'package-identity',
    properties: ['name', 'private', 'type'],
    rule: 'Private Bun ESM alpha tenant; it is not a publishable package.',
  },
  {
    id: 'tenant-runtime',
    properties: ['scripts.test', 'scripts.run-once', 'scripts.run-watch', 'scripts.backtest'],
    rule: 'Execution is event-store based; no command creates a live order route.',
  },
  {
    id: 'circuit',
    properties: ['pModel', 'components', 'asOfMs', 'trading corpus'],
    rule: 'Probability uses only timestamp-causal trading-corpus evidence and model state.',
  },
  {
    id: 'execution-observation',
    properties: ['market_opening_prior', 'market_mid_current', 'book'],
    rule: 'Market observations explain an execution decision but never enter pModel.',
  },
  {
    id: 'environment-and-flags',
    properties: ['ALPHA_LIVE', '--live', '--dry-run', '--db', '--ticker'],
    rule: 'Runtime controls select work or arm an already-approved route; they cannot tune the model.',
  },
] as const;

export const TENNIS_GAME_MODEL_WEIGHT_POLICY = {
  owner: 'player-strengths.ts',
  parameters: ['PRIOR_UNITS', 'MATCH_WEIGHT_GAMES', 'DEFAULT_UNKNOWN_STRENGTH'],
  rule: 'Weights are fixed code parameters. Change only with timestamp-causal trading-corpus evidence and a reviewed backtest; never derive them from latency, UI, cache, or transport telemetry.',
} as const;

export const TENNIS_GAME_MODEL_FLAGS = {
  runOnce: ['--ticker=<Kalshi ticker>', '--fetch-book', '--event=<event id>', '--db=<path>', '--live'],
  watch: ['--db=<path>', '--lead=<minutes>', '--dry-run'],
  batchShadow: ['--db=<path>', '--dry-run', '--from=<YYYY-MM-DD>', '--to=<YYYY-MM-DD>'],
  backtest: ['--db=<path>'],
} as const;

export const TENNIS_GAME_MODEL_DATA_POLICY = {
  fitCorpus: 'trading',
  excludedCorpus: 'research-only',
  evaluationClock: 'book receive timestamp',
  outcomeCutoff: 'event start and resolution timestamps must be at or before asOfMs',
  marketPriceRole: 'decision observation only; never a pModel input',
  noisePolicy: 'diagnostic-only fields may not appear in the signal component map',
} as const;

export function assertPermittedSignalComponents(
  components: Record<string, number>,
): asserts components is TennisGameModelComponents {
  const permitted = new Set<string>(PERMITTED_SIGNAL_COMPONENTS);
  for (const [key, value] of Object.entries(components)) {
    if (!permitted.has(key)) {
      throw new Error(`Unapproved tennis-game-model component: ${key}. Add a causal contract before using it.`);
    }
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid tennis-game-model component ${key}: expected a finite number.`);
    }
  }
}

export function tennisGameModelContractSnapshot() {
  return {
    componentGroups: {
      modelInput: MODEL_INPUT_COMPONENTS,
      matchState: MATCH_STATE_COMPONENTS,
      diagnostics: MODEL_DIAGNOSTIC_COMPONENTS,
      decisionObservation: DECISION_OBSERVATION_COMPONENTS,
    },
    excludedNoise: EXCLUDED_NOISE_FIELDS,
    propertyGroups: TENNIS_GAME_MODEL_PROPERTY_GROUPS,
    weightPolicy: TENNIS_GAME_MODEL_WEIGHT_POLICY,
    environment: TENNIS_GAME_MODEL_ENVIRONMENT,
    flags: TENNIS_GAME_MODEL_FLAGS,
    dataPolicy: TENNIS_GAME_MODEL_DATA_POLICY,
  };
}
