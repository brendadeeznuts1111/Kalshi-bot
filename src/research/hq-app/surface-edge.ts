/**
 * HQ events board — surface-edge helpers (frontend).
 *
 * Consumed by src/research/hq-app/app.js:
 *   - passesMinimumSurfaceEdge(e, floor)   → eventMatches board filter
 *     (glossary ui.events.filter.min_surface_edge: 'Minimum surface-edge
 *     points required to keep a match on the board', 0 = off)
 *   - surfaceEdgePresentation(e)           → surfaceEdgeBadge cell
 *     (tone classes positive|negative|neutral|unavailable in styles.css)
 *   - normalizeTennisFilterKey(k)          → filtersFromHash URL key
 *
 * Event shape comes from the tennis-hq-data enrichment (app.js applies
 * enriched.surfaceEdge* fields onto each event row).
 */

export type HqSurfaceEdgeEvent = {
  surfaceEdge?: number | null;
  surfaceEdgePlayers?: [string | null, string | null] | null;
  surfaceEdgeSamples?: [number, number] | null;
  surfaceEdgeReliable?: boolean;
  surfaceEdgeEvidence?: string | null;
};

/**
 * Board floor filter: keep the match when Player A's surface edge (pp)
 * is at least `minSurfaceEdge`. 0 (or NaN/missing) = filter off.
 */
export function passesMinimumSurfaceEdge(
  event: HqSurfaceEdgeEvent | null | undefined,
  minSurfaceEdge: number | string | null | undefined,
): boolean {
  const floor = Number(minSurfaceEdge) || 0;
  if (floor <= 0) return true; // 0 = off
  const edge = Number(event?.surfaceEdge) || 0;
  return edge >= floor;
}

/**
 * Badge cell for the events board: { label, title, tone }.
 * Tone classes are defined in styles.css (.surface-edge.{positive,
 * negative, neutral, unavailable}).
 */
export function surfaceEdgePresentation(
  event: HqSurfaceEdgeEvent | null | undefined,
): { label: string; title: string; tone: 'positive' | 'negative' | 'neutral' | 'unavailable' } {
  const e = event ?? {};
  const edge = Number(e.surfaceEdge) || 0;
  const reliable = e.surfaceEdgeReliable === true;
  const evidence = e.surfaceEdgeEvidence ?? '';
  if (!reliable || evidence === 'missing-surface') {
    return {
      label: '—',
      title: 'Surface edge unavailable' + (evidence ? ' (' + evidence + ')' : ''),
      tone: 'unavailable',
    };
  }
  const playerA = e.surfaceEdgePlayers?.[0] ?? null;
  const playerB = e.surfaceEdgePlayers?.[1] ?? null;
  const samplesA = e.surfaceEdgeSamples?.[0] ?? 0;
  const samplesB = e.surfaceEdgeSamples?.[1] ?? 0;
  const label = (edge >= 0 ? '+' : '') + edge + 'pp';
  return {
    label,
    title: 'Surface edge ' + label + ' (' + (playerA ?? 'A') + ' vs ' + (playerB ?? 'B') + ' · ' + samplesA + '/' + samplesB + ' samples)',
    tone: edge > 0 ? 'positive' : edge < 0 ? 'negative' : 'neutral',
  };
}

/**
 * Canonicalize a filters-from-hash key to the app.js FILTER_KEYS spelling
 * (camelCase). Accepts any case and _/-/space separators; unknown keys pass
 * through unchanged (app.js filters them via FILTER_KEYS.includes).
 */
const FILTER_KEY_CANONICAL: Record<string, string> = {
  q: 'q',
  league: 'league',
  tournament: 'tournament',
  country: 'country',
  round: 'round',
  surface: 'surface',
  tier: 'tier',
  when: 'when',
  liquidity: 'liquidity',
  minvol: 'minVol',
  maxask: 'maxAsk',
  minsurfaceedge: 'minSurfaceEdge',
  sort: 'sort',
};

export function normalizeTennisFilterKey(rawKey: string | null | undefined): string {
  const raw = String(rawKey ?? '');
  const folded = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return FILTER_KEY_CANONICAL[folded] ?? raw;
}
