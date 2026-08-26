/**
 * Sport-wide **edge pattern** surface — open eyes across sport / market / line.
 *
 * Patterns are pure classifiers: given a priced context they emit ranked hits
 * (severity + note + numeric tags). Settlement weighting is one input; patterns
 * also cover period definition, eligibility, interrupt windows, fill friction.
 *
 * Families converge on reusable edge *types*; sport/market/line scopes filter
 * which fire. Prefer new patterns in a family over one-off sport ifs.
 *
 * @see docs/EDGE-PATTERNS.md
 * @see docs/PLIVE-EZLIVE-SPORTS-RULES.md
 */

import {
  classifyMarketClass,
  defaultVoidPrior,
  resolveSettlementWeighting,
  type SettlementMarketClass,
  type SettlementPhase,
  type SettlementWeighting,
  type VoidRiskLevel,
  type WeightingSportKey,
  weightingSportKey,
} from './weighting.ts';

// ── Taxonomy ───────────────────────────────────────────────────────────────

/**
 * Convergent edge *types* — keep this list short; extend with new patterns,
 * not new families, unless the mechanism is genuinely different.
 */
export const EDGE_PATTERN_FAMILIES = [
  /** Void / no-action / refund vs win-lose binary (retirement, abandon, rain). */
  'void_action',
  /** Period definition: OT/ET/SO/extras included or not on this market. */
  'period_definition',
  /** Line unit mismatch: games vs points vs sets vs goals. */
  'line_unit',
  /** Participant must start / listed / tee-off / must-play. */
  'participant_eligibility',
  /** Interrupt / postpone resume windows (same day, 24h, 72h). */
  'interrupt_window',
  /** Soft fill: secondary confirmation, scoreboard-not-SSOT. */
  'fill_friction',
  /** Outcome already determined → stands on abandon. */
  'already_determined',
  /** Multiway / outright dead heat pro-rata. */
  'dead_heat',
  /** Cross-product non-diff (plive ≡ ezlive) — eyes-open anti-pattern. */
  'cross_product',
  /** Phase flip: prematch vs live changes the product. */
  'phase_split',
] as const;

export type EdgePatternFamily = (typeof EDGE_PATTERN_FAMILIES)[number];

export type EdgePatternSeverity = 'info' | 'watch' | 'high' | 'critical';

/** Line kind — orthogonal to Pandora marketType id. */
export type EdgeLineKind =
  | 'moneyline'
  | 'spread'
  | 'total'
  | 'prop'
  | 'period'
  | 'outright'
  | 'unknown';

export type EdgePatternScope = {
  /** `*` or list of weighting sport keys */
  sports: '*' | readonly WeightingSportKey[];
  marketClasses: '*' | readonly SettlementMarketClass[];
  phases: '*' | readonly SettlementPhase[];
  lineKinds: '*' | readonly EdgeLineKind[];
};

export type EdgePatternContext = {
  sportId: string;
  phase: SettlementPhase;
  marketType?: string | null | undefined;
  period?: string | null | undefined;
  /** Optional decimal odds (for future EV-aware patterns). */
  decimalOdds?: number | null | undefined;
  matchState?: {
    firstSetCompleted?: boolean;
    matchCompleted?: boolean;
    periodCompleted?: boolean;
    /** Game clock minute (soccer abandon 85′). */
    minute?: number;
    /** Injury / retirement signal from operator or feed. */
    injuryRisk?: boolean;
    /** Listed pitcher scratched / inactive player. */
    eligibilityBroken?: boolean;
  } | undefined;
  /** Precomputed settlement (optional; computed if missing). */
  settlement?: SettlementWeighting;
};

export type EdgePatternHit = {
  patternId: string;
  family: EdgePatternFamily;
  title: string;
  severity: EdgePatternSeverity;
  /** One-line eyes-open note for desk / model */
  note: string;
  /** Numeric tags for SignalContext.components / shadow */
  components: Record<string, number>;
  /** Why it matched (sport/market/line/phase) */
  matched: {
    sportKey: WeightingSportKey | null;
    marketClass: SettlementMarketClass;
    lineKind: EdgeLineKind;
    phase: SettlementPhase;
  };
};

export type EdgePattern = {
  /** Stable id — kebab family.slug */
  id: string;
  family: EdgePatternFamily;
  title: string;
  description: string;
  scope: EdgePatternScope;
  /**
   * Return a hit or null. Called only when scope matches.
   * Pure — no I/O.
   */
  evaluate: (ctx: EdgePatternContext, settlement: SettlementWeighting) => EdgePatternHit | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

export function lineKindFromMarketClass(mc: SettlementMarketClass): EdgeLineKind {
  switch (mc) {
    case 'match_ml':
    case 'period_ml':
      return 'moneyline';
    case 'spread':
      return 'spread';
    case 'total':
      return 'total';
    case 'period_prop':
    case 'set_market':
    case 'game_market':
      return 'prop';
    case 'outright':
      return 'outright';
    default:
      return 'unknown';
  }
}

function scopeMatches(
  scope: EdgePatternScope,
  sportKey: WeightingSportKey | null,
  marketClass: SettlementMarketClass,
  phase: SettlementPhase,
  lineKind: EdgeLineKind,
): boolean {
  if (scope.sports !== '*') {
    if (!sportKey || !scope.sports.includes(sportKey)) return false;
  }
  if (scope.marketClasses !== '*' && !scope.marketClasses.includes(marketClass)) return false;
  if (scope.phases !== '*' && !scope.phases.includes(phase)) return false;
  if (scope.lineKinds !== '*' && !scope.lineKinds.includes(lineKind)) return false;
  return true;
}

function severityRank(s: EdgePatternSeverity): number {
  switch (s) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'watch':
      return 2;
    default:
      return 1;
  }
}

/** Sort keys for catalog rows and pattern hits (`--sort-by family|severity|id`). */
export const EDGE_PATTERN_SORT_KEYS = ['family', 'severity', 'id'] as const;
export type EdgePatternSortKey = (typeof EDGE_PATTERN_SORT_KEYS)[number];

export type EdgePatternSortOptions = {
  /** Ordered keys; default `['family', 'id']` for catalog, `['severity', 'id']` for hits. */
  sortBy?: readonly EdgePatternSortKey[];
  /** Reverse overall order after multi-key compare. */
  desc?: boolean | undefined;
};

/** Parse CLI `--sort-by family,severity,id` (unknown tokens dropped). */
export function parseEdgePatternSortBy(
  raw: string | null | undefined,
  fallback: readonly EdgePatternSortKey[] = ['family', 'id'],
): EdgePatternSortKey[] {
  if (!raw?.trim()) return [...fallback];
  const allowed = new Set<string>(EDGE_PATTERN_SORT_KEYS);
  const keys = raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter((k): k is EdgePatternSortKey => allowed.has(k));
  return keys.length ? keys : [...fallback];
}

function cmpStr(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Sort catalog definitions. `severity` is a no-op key on definitions (no fixed
 * severity) — falls through to id so `--sort-by severity` aliases aren't needed.
 */
export function sortEdgePatterns(
  patterns: readonly EdgePattern[],
  options: EdgePatternSortOptions = {},
): EdgePattern[] {
  const keys = options.sortBy?.length ? options.sortBy : (['family', 'id'] as const);
  const dir = options.desc ? -1 : 1;
  return [...patterns].sort((a, b) => {
    for (const key of keys) {
      let c = 0;
      if (key === 'family') c = cmpStr(a.family, b.family);
      else if (key === 'id') c = cmpStr(a.id, b.id);
      else if (key === 'severity') c = cmpStr(a.id, b.id); // catalog has no severity
      if (c !== 0) return c * dir;
    }
    return 0;
  });
}

/** Sort scan hits. Default severity desc, then id asc (ignores outer desc for severity-first). */
export function sortEdgePatternHits(
  hits: readonly EdgePatternHit[],
  options: EdgePatternSortOptions = {},
): EdgePatternHit[] {
  const keys = options.sortBy?.length ? options.sortBy : (['severity', 'id'] as const);
  const desc = Boolean(options.desc);
  return [...hits].sort((a, b) => {
    for (const key of keys) {
      let c = 0;
      if (key === 'severity') {
        // Higher severity first unless --desc (then lowest first)
        c = severityRank(b.severity) - severityRank(a.severity);
        if (desc) c = -c;
      } else if (key === 'family') {
        c = cmpStr(a.family, b.family);
        if (desc) c = -c;
      } else if (key === 'id') {
        c = cmpStr(a.patternId, b.patternId);
        if (desc) c = -c;
      }
      if (c !== 0) return c;
    }
    return 0;
  });
}

function hit(
  pattern: EdgePattern,
  ctx: EdgePatternContext,
  settlement: SettlementWeighting,
  severity: EdgePatternSeverity,
  note: string,
  components: Record<string, number> = {},
): EdgePatternHit {
  const marketClass = settlement.marketClass;
  const lineKind = lineKindFromMarketClass(marketClass);
  return {
    patternId: pattern.id,
    family: pattern.family,
    title: pattern.title,
    severity,
    note,
    components: {
      [`pat_${pattern.id.replace(/[^a-z0-9]+/gi, '_')}`]: severityRank(severity),
      ...components,
    },
    matched: {
      sportKey: settlement.sportKey,
      marketClass,
      lineKind,
      phase: ctx.phase,
    },
  };
}

// ── Pattern catalog ────────────────────────────────────────────────────────

const PATTERNS: EdgePattern[] = [
  // —— void_action ——
  {
    id: 'void.live-ml-unfinished',
    family: 'void_action',
    title: 'Live ML unfinished → void risk',
    description:
      'Live match moneyline requires full completion (tennis shell; similar abandon risk elsewhere). Do not treat mid as pure p_win.',
    scope: {
      sports: '*',
      marketClasses: ['match_ml'],
      phases: ['live'],
      lineKinds: ['moneyline'],
    },
    evaluate(ctx, settlement) {
      if (settlement.voidRisk !== 'high' && settlement.voidRisk !== 'medium') return null;
      if (ctx.matchState?.matchCompleted === true) return null;
      const sev: EdgePatternSeverity =
        settlement.sportKey === 'tennis' || settlement.voidRisk === 'high' ? 'high' : 'watch';
      return hit(
        this,
        ctx,
        settlement,
        sev,
        `Live ML void risk=${settlement.voidRisk} (action: ${settlement.actionThreshold}). Prefer completed period units if available.`,
        {
          pat_void_prior: defaultVoidPrior(settlement.voidRisk),
          pat_prefer_unit: settlement.preferCompletedUnitMarkets ? 1 : 0,
        },
      );
    },
  },
  {
    id: 'void.prematch-before-action-threshold',
    family: 'void_action',
    title: 'Prematch before action threshold',
    description:
      'Prematch ML still inside void window (e.g. tennis before set 1 complete, baseball before 5 inn).',
    scope: {
      sports: '*',
      marketClasses: ['match_ml'],
      phases: ['prematch'],
      lineKinds: ['moneyline'],
    },
    evaluate(ctx, settlement) {
      if (settlement.sportKey === 'tennis' && ctx.matchState?.firstSetCompleted === false) {
        return hit(
          this,
          ctx,
          settlement,
          'high',
          'Prematch tennis ML: first set not complete — retirement/DQ voids.',
          { pat_void_prior: 0.2 },
        );
      }
      if (settlement.voidRisk === 'high' || settlement.voidRisk === 'medium') {
        return hit(
          this,
          ctx,
          settlement,
          settlement.voidRisk === 'high' ? 'watch' : 'info',
          `Prematch ML action threshold: ${settlement.actionThreshold}`,
          { pat_void_prior: defaultVoidPrior(settlement.voidRisk) },
        );
      }
      return null;
    },
  },
  {
    id: 'void.completed-unit-survives',
    family: 'void_action',
    title: 'Completed unit survives stoppage',
    description:
      'Set/game/period markets that finished stay action when match later retires/abandons — structural relative edge vs unfinished ML.',
    scope: {
      sports: '*',
      marketClasses: ['set_market', 'game_market', 'period_ml', 'period_prop'],
      phases: '*',
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      if (ctx.matchState?.periodCompleted !== true) return null;
      return hit(
        this,
        ctx,
        settlement,
        'info',
        'Priced period unit completed — shell typically keeps action if match stops later.',
        { pat_unit_survives: 1 },
      );
    },
  },
  {
    id: 'void.injury-steam-vs-void',
    family: 'void_action',
    title: 'Injury steam vs void branch',
    description:
      'Price shortens on injury while p_void rises — two-way model reads free fade; three-way may skip.',
    scope: {
      sports: '*',
      marketClasses: ['match_ml', 'period_ml'],
      phases: ['live', 'prematch'],
      lineKinds: ['moneyline'],
    },
    evaluate(ctx, settlement) {
      if (!ctx.matchState?.injuryRisk) return null;
      if (settlement.voidRisk === 'low' || settlement.voidRisk === 'unknown') return null;
      return hit(
        this,
        ctx,
        settlement,
        'critical',
        'Injury signal + non-low void risk: size with three-way EV; do not assume lose on retirement.',
        {
          pat_void_prior: Math.max(defaultVoidPrior(settlement.voidRisk), 0.2),
          pat_injury: 1,
        },
      );
    },
  },

  // —— phase_split ——
  {
    id: 'phase.prematch-vs-live-product',
    family: 'phase_split',
    title: 'Prematch vs live is a different product',
    description:
      'Same market coords, different action threshold by phase (tennis ML, basketball/hockey official minutes).',
    scope: {
      sports: '*',
      marketClasses: '*',
      phases: '*',
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      const notes = settlement.movementNotes.filter(n =>
        /prematch|live|not apply|phase/i.test(n),
      );
      if (!notes.length && settlement.sportKey !== 'tennis') return null;
      if (settlement.marketClass !== 'match_ml' && settlement.sportKey !== 'tennis') return null;
      return hit(
        this,
        ctx,
        settlement,
        'watch',
        `Phase=${ctx.phase}: ${settlement.actionThreshold}. Do not pool prematch+live calibration without a phase tag.`,
        { pat_phase_live: ctx.phase === 'live' ? 1 : 0 },
      );
    },
  },

  // —— period_definition ——
  {
    id: 'period.ot-inclusion-mismatch',
    family: 'period_definition',
    title: 'OT / extras inclusion mismatch',
    description:
      'Game/2H includes OT; some periods (Q4) exclude — sharing a total model across periods misprices.',
    scope: {
      sports: ['basketball', 'football', 'hockey', 'baseball'],
      marketClasses: ['total', 'spread', 'period_prop', 'match_ml'],
      phases: '*',
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      const ot = settlement.otFlags;
      if (!ot.gameIncludesOt && !ot.periodExcludesOt && !ot.regulationOnlyDefault) return null;
      const p = String(ctx.period ?? 'm').toLowerCase();
      if (ot.periodExcludesOt) {
        return hit(
          this,
          ctx,
          settlement,
          'high',
          `Period ${p} excludes OT — do not reuse full-game OT-inclusive fair value.`,
          { pat_ot_excl: 1 },
        );
      }
      if (ot.gameIncludesOt && (p === 'm' || p === 'h2')) {
        return hit(
          this,
          ctx,
          settlement,
          'info',
          `Period ${p} includes OT/extras by shell default.`,
          { pat_ot_incl: 1 },
        );
      }
      if (ot.regulationOnlyDefault) {
        return hit(
          this,
          ctx,
          settlement,
          'watch',
          'Soccer-style regulation-only full match unless market labeled otherwise.',
          { pat_reg_only: 1 },
        );
      }
      return null;
    },
  },

  // —— line_unit ——
  {
    id: 'line.unit-points-vs-games',
    family: 'line_unit',
    title: 'Line unit: points vs games/sets',
    description: 'TT/volleyball points; tennis game totals; soccer goals — unit errors are free losses.',
    scope: {
      sports: '*',
      marketClasses: ['total', 'spread', 'set_market', 'game_market'],
      phases: '*',
      lineKinds: ['total', 'spread', 'prop'],
    },
    evaluate(ctx, settlement) {
      const sk = settlement.sportKey;
      if (sk === 'table_tennis' || sk === 'tennis') {
        const unit =
          sk === 'table_tennis'
            ? 'points'
            : settlement.marketClass === 'game_market'
              ? 'games'
              : 'set/games (TB set = 1 game for game H/T)';
        return hit(
          this,
          ctx,
          settlement,
          'watch',
          `Confirm line unit: ${unit}. Wrong unit → systematic misprice.`,
          { pat_line_unit: sk === 'table_tennis' ? 1 : 2 },
        );
      }
      if (sk === 'soccer') {
        return hit(this, ctx, settlement, 'info', 'Soccer totals/spreads: goals unless labeled.', {
          pat_line_unit: 3,
        });
      }
      return null;
    },
  },
  {
    id: 'line.tennis-tiebreak-one-game',
    family: 'line_unit',
    title: 'Tennis tie-break counts as one game',
    description: 'Shell grades TB set winner as +1 game for game handicap/totals.',
    scope: {
      sports: ['tennis'],
      marketClasses: ['total', 'spread', 'set_market', 'game_market'],
      phases: '*',
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      return hit(
        this,
        ctx,
        settlement,
        'watch',
        'Tie-break set = 1 game toward game handicap & game totals — model must match.',
        { pat_tb_one_game: 1 },
      );
    },
  },

  // —— participant_eligibility ——
  {
    id: 'elig.listed-pitcher-or-must-play',
    family: 'participant_eligibility',
    title: 'Listed pitcher / must-play',
    description:
      'MLB listed pitchers; football must-play downs; golf tee-off — eligibility breaks void or kill props.',
    scope: {
      sports: ['baseball', 'football', 'golf'],
      marketClasses: '*',
      phases: '*',
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      if (ctx.matchState?.eligibilityBroken) {
        return hit(
          this,
          ctx,
          settlement,
          'critical',
          'Eligibility broken (scratch/inactive/no tee-off) — expect no-action or prop kill; do not score as lose in calibration.',
          { pat_elig_broken: 1, pat_void_prior: 0.5 },
        );
      }
      if (settlement.sportKey === 'baseball') {
        return hit(
          this,
          ctx,
          settlement,
          'watch',
          'MLB prematch often listed pitchers — track starter news; voids pollute Brier if forced 0/1.',
          { pat_listed_pitcher: 1 },
        );
      }
      if (settlement.sportKey === 'football' && settlement.marketClass === 'period_prop') {
        return hit(
          this,
          ctx,
          settlement,
          'watch',
          'Player props: must-play rules (QB start / one down) — inactives hit props harder than ML.',
          { pat_must_play: 1 },
        );
      }
      if (settlement.sportKey === 'golf') {
        return hit(
          this,
          ctx,
          settlement,
          'info',
          'Golf: action after tee-off; WD after tee-off ≠ auto void.',
          { pat_tee_off: 1 },
        );
      }
      return null;
    },
  },

  // —— interrupt_window ——
  {
    id: 'interrupt.resume-window',
    family: 'interrupt_window',
    title: 'Interrupt / postpone window',
    description: 'Same calendar day vs 24h vs 72h (major soccer) — hold vs cancel risk.',
    scope: {
      sports: '*',
      marketClasses: '*',
      phases: '*',
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      const sk = settlement.sportKey;
      if (sk === 'soccer') {
        return hit(
          this,
          ctx,
          settlement,
          'info',
          'Soccer abandon: unsettled void unless ≥85′; WC/Euro/Copa complete within 72h.',
          { pat_abandon_min: 85 },
        );
      }
      if (sk === 'table_tennis' || sk === 'tennis') {
        return hit(
          this,
          ctx,
          settlement,
          'info',
          'Resume/interrupt window ~24h for unsettled markets (sport card).',
          { pat_resume_h: 24 },
        );
      }
      return hit(
        this,
        ctx,
        settlement,
        'info',
        'Global default: interrupted not resumed same local day → no action (except already determined).',
        { pat_same_day: 1 },
      );
    },
  },

  // —— fill_friction ——
  {
    id: 'fill.secondary-confirmation',
    family: 'fill_friction',
    title: 'Secondary confirmation (in-play)',
    description:
      'Score during countdown cancels leg; short sports (TT) denser — haircut fill, not only vig.',
    scope: {
      sports: '*',
      marketClasses: '*',
      phases: ['live'],
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      const dense =
        settlement.sportKey === 'table_tennis' || settlement.sportKey === 'tennis';
      return hit(
        this,
        ctx,
        settlement,
        dense ? 'watch' : 'info',
        dense
          ? 'In-play secondary confirmation + dense scoring — raise fill-fail prior on live edges.'
          : 'In-play may be subject to secondary confirmation; canceled parlay legs reprice without that leg.',
        { pat_secondary_confirm: dense ? 2 : 1 },
      );
    },
  },
  {
    id: 'fill.scoreboard-not-ssot',
    family: 'fill_friction',
    title: 'Scoreboard is guide only',
    description: 'Widget score/clock not settlement SSOT — do not reprice solely off board lag.',
    scope: {
      sports: '*',
      marketClasses: '*',
      phases: ['live'],
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      return hit(
        this,
        ctx,
        settlement,
        'info',
        'Live scoreboard/stats are informational — grade from official sources, not widget lag.',
        { pat_scoreboard_guide: 1 },
      );
    },
  },

  // —— already_determined ——
  {
    id: 'determined.totals-locked',
    family: 'already_determined',
    title: 'Already determined stands on abandon',
    description:
      'When outcome is unambiguous (e.g. total already over), bets stand even if event stops.',
    scope: {
      sports: '*',
      marketClasses: ['total', 'spread', 'period_prop', 'set_market', 'game_market'],
      phases: '*',
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      // Eyes-open reminder; no auto lock detection without score state
      return hit(
        this,
        ctx,
        settlement,
        'info',
        'If the market is already unconditionally determined, abandon/retirement usually keeps action.',
        { pat_already_det_aware: 1 },
      );
    },
  },

  // —— dead_heat ——
  {
    id: 'deadheat.outright-pro-rata',
    family: 'dead_heat',
    title: 'Outright / top-N dead heat',
    description: 'Multiway ties pro-rate win/lose — binary model overstates payout.',
    scope: {
      sports: '*',
      marketClasses: ['outright'],
      phases: '*',
      lineKinds: ['outright'],
    },
    evaluate(ctx, settlement) {
      return hit(
        this,
        ctx,
        settlement,
        'watch',
        'Dead heat rules may apply on outright/top-N — EV needs pro-rata, not full win.',
        { pat_dead_heat: 1 },
      );
    },
  },

  // —— cross_product ——
  {
    id: 'cross.plive-eq-ezlive',
    family: 'cross_product',
    title: 'plive ≡ ezlive settlement',
    description: 'No arb between products — shared shell rules.',
    scope: {
      sports: '*',
      marketClasses: '*',
      phases: '*',
      lineKinds: '*',
    },
    evaluate(ctx, settlement) {
      if (!settlement.settlementIdenticalPliveEzlive) return null;
      // Only emit once as soft info when explicitly useful — keep low noise: info only for match ML
      if (settlement.marketClass !== 'match_ml') return null;
      return hit(
        this,
        ctx,
        settlement,
        'info',
        'plive and ezlive share settlement — product switch is capacity/session only, not a rules edge.',
        { pat_plive_eq_ezlive: 1 },
      );
    },
  },
];

// ── Public API ─────────────────────────────────────────────────────────────

/** All registered patterns (immutable catalog). */
export function listEdgePatterns(): readonly EdgePattern[] {
  return PATTERNS;
}

export function listEdgePatternFamilies(): readonly EdgePatternFamily[] {
  return EDGE_PATTERN_FAMILIES;
}

export function getEdgePattern(id: string): EdgePattern | undefined {
  return PATTERNS.find(p => p.id === id);
}

export type EdgePatternScanResult = {
  settlement: SettlementWeighting;
  hits: EdgePatternHit[];
  /** Max severity among hits */
  maxSeverity: EdgePatternSeverity;
  /** Merged components from all hits + settlement */
  components: Record<string, number>;
  /** Compact desk lines */
  eyeOpeners: string[];
};

/**
 * Scan all in-scope patterns for this context.
 * Default sort: severity (critical→info) then id. Override with `sort`.
 */
export function scanEdgePatterns(
  ctx: EdgePatternContext,
  sort: EdgePatternSortOptions = {},
): EdgePatternScanResult {
  const settlement =
    ctx.settlement ??
    resolveSettlementWeighting({
      sportId: ctx.sportId,
      phase: ctx.phase,
      marketType: ctx.marketType,
      period: ctx.period,
      matchState: ctx.matchState,
    });

  const sportKey = settlement.sportKey ?? weightingSportKey(ctx.sportId);
  const marketClass = settlement.marketClass;
  const lineKind = lineKindFromMarketClass(marketClass);
  let hits: EdgePatternHit[] = [];

  for (const pattern of PATTERNS) {
    if (!scopeMatches(pattern.scope, sportKey, marketClass, ctx.phase, lineKind)) continue;
    const h = pattern.evaluate(ctx, settlement);
    if (h) hits.push(h);
  }

  hits = sortEdgePatternHits(hits, {
    sortBy: sort.sortBy?.length ? sort.sortBy : ['severity', 'id'],
    desc: sort.desc,
  });

  const maxSeverity: EdgePatternSeverity = hits.reduce(
    (m, h) => (severityRank(h.severity) > severityRank(m) ? h.severity : m),
    'info' as EdgePatternSeverity,
  );

  const components: Record<string, number> = {
    settlement_void_risk:
      settlement.voidRisk === 'high'
        ? 3
        : settlement.voidRisk === 'medium'
          ? 2
          : settlement.voidRisk === 'low'
            ? 1
            : 0,
    settlement_phase_live: ctx.phase === 'live' ? 1 : 0,
    settlement_p_void_prior: defaultVoidPrior(settlement.voidRisk),
    pat_hit_count: hits.length,
    pat_max_severity: severityRank(maxSeverity),
  };
  for (const h of hits) {
    Object.assign(components, h.components);
  }

  const eyeOpeners = hits
    .filter(h => h.severity !== 'info')
    .map(h => `[${h.severity}] ${h.patternId}: ${h.note}`);

  return { settlement, hits, maxSeverity, components, eyeOpeners };
}

/** Family → pattern ids (for docs / CLI catalog). */
export function edgePatternsByFamily(): Record<EdgePatternFamily, string[]> {
  const out = {} as Record<EdgePatternFamily, string[]>;
  for (const f of EDGE_PATTERN_FAMILIES) out[f] = [];
  for (const p of PATTERNS) out[p.family].push(p.id);
  return out;
}

/**
 * Human catalog. Default groups by family (sort family,id).
 * `--sort-by id` flattens to a single list ordered by id.
 */
export function formatEdgePatternCatalog(options: EdgePatternSortOptions = {}): string {
  const keys = options.sortBy?.length ? options.sortBy : (['family', 'id'] as const);
  const sorted = sortEdgePatterns(listEdgePatterns(), {
    sortBy: keys,
    desc: options.desc,
  });

  // Flat list when primary key is id (or only severity which maps to id for catalog)
  if (keys[0] === 'id') {
    const lines: string[] = [
      `# Edge pattern catalog (sort-by ${keys.join(',')}${options.desc ? ' desc' : ''})`,
      '',
    ];
    for (const p of sorted) {
      lines.push(`- **\`${p.id}\`** · \`${p.family}\` — ${p.title}`);
      lines.push(`  ${p.description}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  // Group by family in sorted order of first appearance
  const lines: string[] = [
    `# Edge pattern catalog (sort-by ${keys.join(',')}${options.desc ? ' desc' : ''})`,
    '',
  ];
  let currentFamily: string | null = null;
  for (const p of sorted) {
    if (p.family !== currentFamily) {
      currentFamily = p.family;
      lines.push(`## ${currentFamily}`);
      lines.push('');
    }
    lines.push(`- **\`${p.id}\`** — ${p.title}`);
    lines.push(`  ${p.description}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Map void risk to a coarse score for external consumers. */
export function voidRiskScore(v: VoidRiskLevel): number {
  return v === 'high' ? 3 : v === 'medium' ? 2 : v === 'low' ? 1 : 0;
}
