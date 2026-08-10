/**
 * Pandora coefficient market helpers (tennis + table tennis proven).
 *
 * Market 16 (set correct score), BO5 first-to-3:
 *   lineId = (p1_sets << 16) | p2_sets
 *   e.g. 196609 = 3-1, 3 = 0-3, 65539 = 1-3
 *
 * Market 18 (game winner, TT set games):
 *   selection keys are odd game numbers (3,5,7,9); o = [p1, p2]
 */

/** Proven market type ids → short labels (Pandora + ticket share ids). */
export const PANDORA_MARKET_LABELS = {
  '1': 'moneyline_3way',
  '3': 'moneyline',
  '5': 'total',
  '6': 'handicap',
  '7': 'total_points',
  '8': 'team_total',
  '9': 'correct_score_sets',
  '16': 'set_correct_score',
  '18': 'game_winner',
  '20': 'set_total_games',
  '21': 'set_game_handicap',
} as const;

export type PandoraMarketTypeId = keyof typeof PANDORA_MARKET_LABELS;

export function pandoraMarketLabel(marketType: string | number): string {
  const id = String(marketType).trim();
  const known = PANDORA_MARKET_LABELS[id as PandoraMarketTypeId];
  return known ?? `market:${id || '?'}`;
}

/**
 * Decode market-16 style set correct-score line id.
 * Returns null when not a finite non-negative integer.
 */
export function decodeSetCorrectScoreLineId(
  lineId: string | number
): { homeSets: number; awaySets: number; lineId: number } | null {
  const n = typeof lineId === 'number' ? lineId : Number(lineId);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  const homeSets = (n >>> 16) & 0xffff;
  const awaySets = n & 0xffff;
  return { homeSets, awaySets, lineId: n };
}

/** Encode set correct-score selection key (market 16). */
export function encodeSetCorrectScoreLineId(
  homeSets: number,
  awaySets: number
): number {
  const h = Math.max(0, Math.floor(homeSets)) & 0xffff;
  const a = Math.max(0, Math.floor(awaySets)) & 0xffff;
  return (h << 16) | a;
}

/** Format 3-1 style label from market-16 line id. */
export function formatSetCorrectScoreLineId(
  lineId: string | number
): string | null {
  const d = decodeSetCorrectScoreLineId(lineId);
  if (!d) return null;
  return `${d.homeSets}-${d.awaySets}`;
}

/**
 * Best-of-N set correct scores that appear as market-16 keys
 * (first to ceil(N/2) sets). For BO5 → first to 3.
 */
export function enumerateSetCorrectScoreLines(
  firstToSets: number
): Array<{ lineId: number; label: string; homeSets: number; awaySets: number }> {
  const win = Math.max(1, Math.floor(firstToSets));
  const out: Array<{
    lineId: number;
    label: string;
    homeSets: number;
    awaySets: number;
  }> = [];
  for (let loser = 0; loser < win; loser++) {
    // home wins
    out.push({
      lineId: encodeSetCorrectScoreLineId(win, loser),
      label: `${win}-${loser}`,
      homeSets: win,
      awaySets: loser,
    });
    // away wins
    out.push({
      lineId: encodeSetCorrectScoreLineId(loser, win),
      label: `${loser}-${win}`,
      homeSets: loser,
      awaySets: win,
    });
  }
  return out.sort((a, b) => a.lineId - b.lineId);
}

/** Table tennis match format default: best-of-5 (first to 3 sets). */
export const TABLE_TENNIS_FIRST_TO_SETS = 3 as const;

/**
 * Human summary for a coefficient selection under a market type.
 * market 16 → "3-1"; market 18 → "game 5"; else selection as-is.
 */
export function describeCoefficientSelection(
  marketType: string | number,
  selection: string,
  options: { sideIndex?: 0 | 1 | null } = {}
): string {
  const mt = String(marketType);
  if (mt === '16') {
    const label = formatSetCorrectScoreLineId(selection);
    return label ? `set_score ${label}` : `sel=${selection}`;
  }
  if (mt === '18') {
    const side =
      options.sideIndex === 0
        ? 'p1'
        : options.sideIndex === 1
          ? 'p2'
          : null;
    return side
      ? `game ${selection} ${side}`
      : `game ${selection}`;
  }
  if (mt === '5' || mt === '6' || mt === '7' || mt === '8') {
    const side =
      options.sideIndex === 0
        ? 'over/home'
        : options.sideIndex === 1
          ? 'under/away'
          : null;
    return side ? `${selection} ${side}` : selection;
  }
  return selection;
}

// ── Vig / overround (decimal books) ──────────────────────────────────────

/** Implied probability from decimal odds: 1/decimal. */
export function decimalToImplied(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) return NaN;
  return 1 / decimal;
}

export type OverroundResult = {
  /** Sum of raw implied probs (may be > 1). */
  impliedSum: number;
  /** impliedSum − 1 (≥ 0 when book is coherent). */
  overround: number;
  /** overround × 100 (e.g. 9.04 for 9.04% vig). */
  vigPercent: number;
  /** Probs renormalized to sum 1. */
  fairProbs: number[];
  n: number;
};

/**
 * Multi-way overround / vig from a list of decimal prices.
 * Uses all prices as mutually exclusive outcomes (moneyline, m/16 scorelines).
 */
export function overroundFromDecimals(decimals: number[]): OverroundResult | null {
  const prices = decimals.filter(d => Number.isFinite(d) && d > 1);
  if (prices.length < 2) return null;
  const implied = prices.map(decimalToImplied);
  if (implied.some(p => !Number.isFinite(p))) return null;
  const impliedSum = implied.reduce((a, b) => a + b, 0);
  if (impliedSum <= 0) return null;
  const overround = impliedSum - 1;
  return {
    impliedSum,
    overround,
    vigPercent: overround * 100,
    fairProbs: implied.map(p => p / impliedSum),
    n: prices.length,
  };
}

export type CoefficientLineLike = {
  period: string;
  marketType: string;
  selection: string;
  decimal: number;
  sideIndex?: 0 | 1;
};

export type MarketVigRow = {
  period: string;
  marketType: string;
  label: string;
  /** Prices used in overround (primary legs only). */
  prices: Array<{
    selection: string;
    selectionLabel: string;
    decimal: number;
    implied: number;
  }>;
  impliedSum: number;
  vigPercent: number;
  kind: 'two_way' | 'multi_way';
};

/**
 * Pick primary decimal for a selection under a market.
 * market 16 often has a ~1.0 "refund" companion — keep the longer-priced side
 * (or sideIndex 0 when both are genuine).
 */
function primaryDecimalsBySelection(
  lines: CoefficientLineLike[],
  marketType: string
): Map<string, number> {
  const bySel = new Map<string, number[]>();
  for (const l of lines) {
    if (l.marketType !== marketType) continue;
    if (!Number.isFinite(l.decimal) || l.decimal <= 1) continue;
    const arr = bySel.get(l.selection) ?? [];
    arr.push(l.decimal);
    bySel.set(l.selection, arr);
  }
  const out = new Map<string, number>();
  for (const [sel, arr] of bySel) {
    if (marketType === '16') {
      // multi-way: drop near-even 1.0x junk; take max priced outcome
      const real = arr.filter(d => d >= 1.05);
      const pick = (real.length ? real : arr).reduce((a, b) =>
        a > b ? a : b
      );
      out.set(sel, pick);
    } else if (arr.length === 1) {
      out.set(sel, arr[0]!);
    } else {
      // two-sided line key (totals/spreads): keep both as separate keys later
      out.set(sel, arr[0]!);
      // also store second under side markers if needed — handled below
    }
  }
  return out;
}

/**
 * Collect vig rows from extracted coefficient lines.
 * - m/3: two-way 1 vs 2
 * - m/5,6,7,8,18: two-way over/under or home/away pairs (sideIndex)
 * - m/16: multi-way set correct score (primary price per scoreline)
 */
export function vigFromCoefficientLines(
  lines: CoefficientLineLike[],
  options: { period?: string | null } = {}
): MarketVigRow[] {
  const periodFilter = options.period?.trim() || null;
  const scoped = periodFilter
    ? lines.filter(l => l.period === periodFilter)
    : lines;

  const keys = new Set(
    scoped.map(l => `${l.period}\0${l.marketType}`)
  );
  const rows: MarketVigRow[] = [];

  for (const key of [...keys].sort()) {
    const [period, marketType] = key.split('\0') as [string, string];
    const group = scoped.filter(
      l => l.period === period && l.marketType === marketType
    );
    if (!group.length) continue;

    let prices: MarketVigRow['prices'] = [];
    let kind: MarketVigRow['kind'] = 'two_way';

    if (marketType === '16') {
      kind = 'multi_way';
      const prim = primaryDecimalsBySelection(group, '16');
      for (const [sel, dec] of [...prim.entries()].sort(
        (a, b) => Number(a[0]) - Number(b[0])
      )) {
        const imp = decimalToImplied(dec);
        if (!Number.isFinite(imp)) continue;
        prices.push({
          selection: sel,
          selectionLabel: formatSetCorrectScoreLineId(sel) ?? sel,
          decimal: dec,
          implied: imp,
        });
      }
    } else if (
      marketType === '5' ||
      marketType === '6' ||
      marketType === '7' ||
      marketType === '8' ||
      marketType === '18'
    ) {
      // pair markets: group by selection line, take sideIndex 0 and 1
      const bySel = new Map<string, { 0?: number; 1?: number }>();
      for (const l of group) {
        const slot = bySel.get(l.selection) ?? {};
        if (l.sideIndex === 0 || l.sideIndex === 1) {
          slot[l.sideIndex] = l.decimal;
        } else if (slot[0] == null) {
          slot[0] = l.decimal;
        } else {
          slot[1] = l.decimal;
        }
        bySel.set(l.selection, slot);
      }
      // Prefer featured main line when multiple: pick selection with both sides
      // and middle-ish; else all pairs
      for (const [sel, sides] of bySel) {
        if (sides[0] != null && sides[1] != null) {
          for (const si of [0, 1] as const) {
            const dec = sides[si]!;
            const imp = decimalToImplied(dec);
            if (!Number.isFinite(imp)) continue;
            prices.push({
              selection: `${sel}:${si}`,
              selectionLabel: describeCoefficientSelection(marketType, sel, {
                sideIndex: si,
              }),
              decimal: dec,
              implied: imp,
            });
          }
          // one line key per market for vig (first complete pair)
          break;
        }
      }
      // if no pair found, fall through to sides 1/2 style
      if (prices.length < 2) {
        prices = [];
        for (const l of group) {
          const imp = decimalToImplied(l.decimal);
          if (!Number.isFinite(imp)) continue;
          prices.push({
            selection: l.selection,
            selectionLabel: l.selection,
            decimal: l.decimal,
            implied: imp,
          });
        }
      }
    } else {
      // moneyline / correct_score_sets: unique selections
      const bySel = new Map<string, number>();
      for (const l of group) {
        const prev = bySel.get(l.selection);
        if (prev == null || l.decimal > prev) bySel.set(l.selection, l.decimal);
      }
      for (const [sel, dec] of [...bySel.entries()].sort((a, b) =>
        a[0].localeCompare(b[0])
      )) {
        const imp = decimalToImplied(dec);
        if (!Number.isFinite(imp)) continue;
        prices.push({
          selection: sel,
          selectionLabel: sel,
          decimal: dec,
          implied: imp,
        });
      }
      if (prices.length > 2) kind = 'multi_way';
    }

    if (prices.length < 2) continue;
    const or = overroundFromDecimals(prices.map(p => p.decimal));
    if (!or) continue;
    rows.push({
      period,
      marketType,
      label: pandoraMarketLabel(marketType),
      prices,
      impliedSum: or.impliedSum,
      vigPercent: or.vigPercent,
      kind,
    });
  }

  return rows.sort((a, b) =>
    a.period === b.period
      ? a.marketType.localeCompare(b.marketType)
      : a.period.localeCompare(b.period)
  );
}

export function formatMarketVigRows(
  rows: MarketVigRow[],
  options: { limit?: number } = {}
): string[] {
  const limit = options.limit ?? 20;
  const out: string[] = [];
  for (const r of rows.slice(0, limit)) {
    const sample = r.prices
      .slice(0, 6)
      .map(p => `${p.selectionLabel}@${p.decimal.toFixed(2)}`)
      .join(' ');
    out.push(
      `  ${r.period}/${r.marketType} ${r.label}  vig=${r.vigPercent.toFixed(2)}%  ` +
        `sum_imp=${r.impliedSum.toFixed(3)}  ${r.kind}  ${sample}`
    );
  }
  return out;
}
