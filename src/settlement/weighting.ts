/**
 * Plive / EZLive shell settlement weighting — pure, no I/O.
 *
 * Source snapshot: docs/artifacts/plive-ezlive-sports-rules.json → weighting v2
 * (SportsWidgets Rules panel). plive ≡ ezlive on settlement.
 *
 * Use before sizing line moves: attach void branch + action threshold by
 * sport × phase × market class.
 */

export type SettlementPhase = 'prematch' | 'live';

export type VoidRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

/** Coarse market class for action thresholds (Pandora marketType mapped in). */
export type SettlementMarketClass =
  | 'match_ml'
  | 'period_ml'
  | 'spread'
  | 'total'
  | 'period_prop'
  | 'set_market'
  | 'game_market'
  | 'outright'
  | 'other';

export type WeightingSportKey =
  | 'tennis'
  | 'table_tennis'
  | 'soccer'
  | 'basketball'
  | 'baseball'
  | 'hockey'
  | 'football'
  | 'golf';

export type SportWeightingRules = {
  inventoryBucket: string;
  movement_notes?: string[];
  [key: string]: unknown;
};

export type WeightingIndex = {
  version: number;
  captured: string;
  products: readonly string[];
  settlement_identical: boolean;
  general: Record<string, boolean>;
  sports: Record<string, SportWeightingRules>;
};

/** Embedded SSOT — keep in sync with docs/artifacts/plive-ezlive-sports-rules.json weighting. */
export const DEFAULT_WEIGHTING: WeightingIndex = {
  version: 2,
  captured: '2026-08-10',
  products: ['plive', 'ezlive'],
  settlement_identical: true,
  general: {
    scoreboard_is_guide_only: true,
    ticket_price_locked_on_accept: true,
    secondary_confirmation_inplay: true,
    interrupted_same_calendar_day_default: true,
    postponed_next_day_void_default: true,
    forfeit_walkover_fixture_void: true,
    dead_heat_outrights: true,
    official_site_day_of_event_ssot: true,
  },
  sports: {
    tennis: {
      inventoryBucket: 'tennis',
      prematch_ml_action: 'first_set_completed',
      live_ml_action: 'match_completed',
      other_markets: 'period_completed_before_stop',
      completed_set_bets_survive_retirement: true,
      postpone_resume_window_hours: 24,
      tiebreak_counts_as_games: 1,
      void_risk_live_ml_on_retirement: 'high',
      void_risk_prematch_ml_after_set1: 'low',
      movement_notes: [
        'Injury news on live ML: model void branch, not pure lose',
        'Prematch ML after set 1: progressor settlement — price moves still matter for residual',
        'Set/game props: incomplete unit → void',
      ],
    },
    table_tennis: {
      inventoryBucket: 'table_tennis',
      interrupt_void_hours: 24,
      spreads_totals_unit: 'points',
      void_risk_unfinished: 'high',
      movement_notes: [
        'Short matches — secondary confirmation + interrupt risk denser than court tennis',
      ],
    },
    soccer: {
      inventoryBucket: 'football',
      full_match_period: 'regulation_only_default',
      action_minute_abandon: 85,
      first_half_needs_break: true,
      goalscorer_includes_et: false,
      goalscorer_includes_pens: false,
      major_tournament_complete_window_hours: 72,
      void_risk_before_85: 'high',
      movement_notes: [
        'Red card / injury: full-match markets still reg-time unless labeled',
        "Abandon before 85' → unsettled void; after 85' action",
      ],
    },
    basketball: {
      inventoryBucket: 'basketball',
      game_and_2h_include_ot: true,
      q4_includes_ot: false,
      prematch_min_minutes_nba: 43,
      prematch_min_minutes_ncaa_intl: 35,
      prematch_min_applies_to_live: false,
      void_risk_early_stop_prematch: 'medium',
      movement_notes: [
        'OT inclusion differs Q4 vs full game — do not share totals model blindly',
        'Prematch action minutes do NOT apply to live',
      ],
    },
    baseball: {
      inventoryBucket: 'baseball',
      extras_in_full_game: true,
      prematch_ml_official_innings: '5 (4.5 if home ahead)',
      other_full_game_need_scheduled_innings: true,
      listed_pitchers_default_mlb_prematch: true,
      void_risk_rain_delay: 'high',
      movement_notes: [
        'Listed pitcher changes void/no-action ML — track starter news hard',
        'Totals/run lines need full scheduled innings unless already determined',
      ],
    },
    hockey: {
      inventoryBucket: 'hockey',
      full_and_period_include_ot_so: true,
      regulation_only_excludes_ot_so: true,
      shootout_goal_count: 1,
      prematch_official_minutes_nhl_ncaa: 55,
      prematch_min_applies_to_live: false,
      player_props_include_ot: true,
      player_props_include_so: false,
      movement_notes: [
        '3-way vs 2-way OT definition is the whole edge on tight games',
        'Shootout = 1 goal for game markets that include SO',
      ],
    },
    football: {
      inventoryBucket: 'american_football',
      game_and_2h_include_ot: true,
      q4_includes_ot: false,
      venue_change_void: true,
      player_props_must_play: 'one_down (QB must start; receiving props special)',
      movement_notes: [
        'Inactive list moves props harder than ML when must-play applies',
        'Venue change voids — unlike basketball home-designation rule',
      ],
    },
    golf: {
      inventoryBucket: 'golf',
      action_after_tee_off: true,
      outright_dead_heat: true,
      shortened_tournament_outright_stands: true,
      shortened_voids: ['correct_scores', 'handicaps', 'player_points', 'winning_margins'],
      movement_notes: [
        'Withdrawal after tee-off = action (usually loss) — not auto void',
        'Weather shortened formats: check market class before holding totals/margins',
      ],
    },
  },
};

/** Map domain SportId / inventory bucket aliases → weighting sports key. */
export function weightingSportKey(sportId: string | null | undefined): WeightingSportKey | null {
  if (!sportId) return null;
  const s = sportId.trim().toLowerCase().replace(/-/g, '_');
  switch (s) {
    case 'tennis':
      return 'tennis';
    case 'table_tennis':
    case 'tabletennis':
    case 'tt':
      return 'table_tennis';
    case 'soccer':
    case 'football_soccer':
      return 'soccer';
    case 'basketball':
      return 'basketball';
    case 'baseball':
      return 'baseball';
    case 'hockey':
    case 'ice_hockey':
      return 'hockey';
    case 'football':
    case 'american_football':
    case 'nfl':
    case 'ncaaf':
      return 'football';
    case 'golf':
      return 'golf';
    default:
      return null;
  }
}

/**
 * Classify Pandora marketType + period into a settlement market class.
 * marketType ids: see KNOWN_MARKET_LABELS in domain/odds-selection.ts
 */
export function classifyMarketClass(
  marketType: string | null | undefined,
  period: string | null | undefined,
): SettlementMarketClass {
  const m = String(marketType ?? '').trim();
  const p = String(period ?? 'm').trim().toLowerCase();
  const isMatchPeriod = p === 'm' || p === '' || p === 'p' || p === 'pp' || p === 'sgp' || p === 'bb';
  const isSetPeriod = /^s\d+$/.test(p);
  const isGamePeriod = /^g\d+$/.test(p);

  if (m === '30') return 'outright';
  if (m === '18') return 'game_market';
  if (m === '9' || m === '16' || m === '20' || m === '21') return 'set_market';
  if (m === '5' || m === '7' || m === '8') {
    return isMatchPeriod ? 'total' : 'period_prop';
  }
  if (m === '6') {
    return isMatchPeriod ? 'spread' : 'period_prop';
  }
  if (m === '1' || m === '3' || m === '4') {
    if (isMatchPeriod) return 'match_ml';
    if (isSetPeriod || isGamePeriod) return 'period_ml';
    return 'period_ml';
  }
  if (isSetPeriod) return 'set_market';
  if (isGamePeriod) return 'game_market';
  return 'other';
}

export type SettlementContextInput = {
  sportId: string;
  /** prematch | live — required for tennis ML split */
  phase: SettlementPhase;
  marketType?: string | null | undefined;
  period?: string | null | undefined;
  /**
   * Match state for tennis retirement grading (optional).
   * firstSetCompleted: set 1 finished
   * matchCompleted: full match finished
   * periodCompleted: the priced period unit finished
   */
  matchState?: {
    firstSetCompleted?: boolean;
    matchCompleted?: boolean;
    periodCompleted?: boolean;
  } | undefined;
  /** Override embedded index (tests). */
  index?: WeightingIndex;
};

export type SettlementWeighting = {
  sportKey: WeightingSportKey | null;
  phase: SettlementPhase;
  marketClass: SettlementMarketClass;
  /** Human action threshold label */
  actionThreshold: string;
  voidRisk: VoidRiskLevel;
  /** Prefer set/game markets over ML when true */
  preferCompletedUnitMarkets: boolean;
  /** OT / period definition flags (sport-specific) */
  otFlags: {
    gameIncludesOt?: boolean;
    periodExcludesOt?: boolean;
    regulationOnlyDefault?: boolean;
  };
  movementNotes: string[];
  /** Structured tennis retirement path when applicable */
  tennisRetirement?: {
    prematchMlAction: 'first_set_completed' | 'void';
    liveMlAction: 'match_completed' | 'void';
    /** If match stopped now: would this market have action? */
    wouldHaveAction: boolean | null;
  } | undefined;
  settlementIdenticalPliveEzlive: boolean;
  sourceCaptured: string;
};

function asVoidRisk(v: unknown): VoidRiskLevel {
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return 'unknown';
}

/**
 * Resolve settlement weighting for a priced line (or hypothetical line).
 */
export function resolveSettlementWeighting(input: SettlementContextInput): SettlementWeighting {
  const index = input.index ?? DEFAULT_WEIGHTING;
  const sportKey = weightingSportKey(input.sportId);
  const marketClass = classifyMarketClass(input.marketType, input.period);
  const phase = input.phase;
  const rules = sportKey ? index.sports[sportKey] : undefined;
  const notes = (rules?.movement_notes as string[] | undefined) ?? [];

  const otFlags: SettlementWeighting['otFlags'] = {};
  if (sportKey === 'basketball' || sportKey === 'football') {
    otFlags.gameIncludesOt = Boolean(rules?.game_and_2h_include_ot);
    const p = String(input.period ?? 'm').toLowerCase();
    if (p === 'q4' || p === 's4') otFlags.periodExcludesOt = !Boolean(rules?.q4_includes_ot);
  }
  if (sportKey === 'soccer') {
    otFlags.regulationOnlyDefault = true;
  }
  if (sportKey === 'hockey') {
    otFlags.gameIncludesOt = Boolean(rules?.full_and_period_include_ot_so);
  }

  let actionThreshold = 'sport_default';
  let voidRisk: VoidRiskLevel = 'unknown';
  let preferCompletedUnitMarkets = false;
  let tennisRetirement: SettlementWeighting['tennisRetirement'];

  if (sportKey === 'tennis') {
    const firstSet = input.matchState?.firstSetCompleted;
    const matchDone = input.matchState?.matchCompleted;
    const periodDone = input.matchState?.periodCompleted;

    if (marketClass === 'match_ml') {
      if (phase === 'prematch') {
        actionThreshold = 'first_set_completed';
        voidRisk =
          firstSet === true
            ? asVoidRisk(rules?.void_risk_prematch_ml_after_set1)
            : firstSet === false
              ? 'high'
              : asVoidRisk(rules?.void_risk_live_ml_on_retirement) === 'high'
                ? 'medium'
                : 'medium';
        // Without state: retirement risk before set 1 is material; after set 1 low
        if (firstSet == null) voidRisk = 'medium';
      } else {
        actionThreshold = 'match_completed';
        voidRisk = asVoidRisk(rules?.void_risk_live_ml_on_retirement);
        preferCompletedUnitMarkets = true;
      }

      let wouldHaveAction: boolean | null = null;
      if (phase === 'prematch') {
        if (matchDone === true || firstSet === true) wouldHaveAction = true;
        else if (firstSet === false) wouldHaveAction = false;
      } else {
        if (matchDone === true) wouldHaveAction = true;
        else if (matchDone === false) wouldHaveAction = false;
      }

      tennisRetirement = {
        prematchMlAction: 'first_set_completed',
        liveMlAction: 'match_completed',
        wouldHaveAction,
      };
    } else if (marketClass === 'set_market' || marketClass === 'period_ml') {
      actionThreshold = 'period_completed_before_stop';
      voidRisk = periodDone === true ? 'low' : periodDone === false ? 'high' : 'medium';
      if (rules?.completed_set_bets_survive_retirement && periodDone === true) {
        voidRisk = 'low';
      }
    } else if (marketClass === 'game_market') {
      actionThreshold = 'game_completed';
      voidRisk = periodDone === true ? 'low' : 'high';
    } else {
      actionThreshold = 'period_completed_before_stop';
      voidRisk = 'medium';
    }
  } else if (sportKey === 'table_tennis') {
    actionThreshold = 'resume_within_24h_or_complete';
    voidRisk = asVoidRisk(rules?.void_risk_unfinished);
  } else if (sportKey === 'soccer') {
    actionThreshold = 'regulation; abandon≥85′ action';
    voidRisk = asVoidRisk(rules?.void_risk_before_85);
  } else if (sportKey === 'basketball') {
    actionThreshold =
      phase === 'prematch' ? 'prematch_min_minutes (NBA 43′ / NCAA 35′)' : 'live_no_min_minutes';
    voidRisk = asVoidRisk(rules?.void_risk_early_stop_prematch);
  } else if (sportKey === 'baseball') {
    actionThreshold = 'ML: 5 inn (4.5 home); others: scheduled innings';
    voidRisk = asVoidRisk(rules?.void_risk_rain_delay);
  } else if (sportKey === 'hockey') {
    actionThreshold = phase === 'prematch' ? 'prematch 55′ NHL/NCAA' : 'live_no_min_minutes';
    voidRisk = 'medium';
  } else if (sportKey === 'football') {
    actionThreshold = 'game/2H incl OT; Q4 excl OT; venue change void';
    voidRisk = 'medium';
  } else if (sportKey === 'golf') {
    actionThreshold = 'tee_off for player action';
    voidRisk = 'low';
  }

  return {
    sportKey,
    phase,
    marketClass,
    actionThreshold,
    voidRisk,
    preferCompletedUnitMarkets,
    otFlags,
    movementNotes: notes,
    tennisRetirement,
    settlementIdenticalPliveEzlive: index.settlement_identical,
    sourceCaptured: index.captured,
  };
}

/**
 * Tennis match ML: would shell grade as action if match stops now?
 * Prematch: first set completed. Live: full match completed.
 */
export function tennisMatchMlWouldHaveAction(
  phase: SettlementPhase,
  state: { firstSetCompleted?: boolean; matchCompleted?: boolean },
): boolean | null {
  if (phase === 'live') {
    if (state.matchCompleted === true) return true;
    if (state.matchCompleted === false) return false;
    return null;
  }
  if (state.matchCompleted === true || state.firstSetCompleted === true) return true;
  if (state.firstSetCompleted === false) return false;
  return null;
}

/**
 * Suggested prior mass on void for sizing (not a calibrated model).
 * High risk → 0.15, medium 0.05, low 0.01, unknown 0.
 */
export function defaultVoidPrior(voidRisk: VoidRiskLevel): number {
  switch (voidRisk) {
    case 'high':
      return 0.15;
    case 'medium':
      return 0.05;
    case 'low':
      return 0.01;
    default:
      return 0;
  }
}

/** Numeric components for SignalContext.components / shadow log. */
export function settlementComponents(w: SettlementWeighting): Record<string, number> {
  return {
    settlement_void_risk:
      w.voidRisk === 'high' ? 3 : w.voidRisk === 'medium' ? 2 : w.voidRisk === 'low' ? 1 : 0,
    settlement_phase_live: w.phase === 'live' ? 1 : 0,
    settlement_prefer_unit_markets: w.preferCompletedUnitMarkets ? 1 : 0,
    settlement_p_void_prior: defaultVoidPrior(w.voidRisk),
  };
}
