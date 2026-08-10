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
