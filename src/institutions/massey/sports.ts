/**
 * Massey Ratings sport/subdivision registry (verified 2026-08-22 via Bun.WebView).
 *
 * Modern Massey paths are `/{sport}/{subdivision}/ratings` (e.g.
 * `cvol/ncaa-d1/ratings` → "College Volleyball : NCAA D1 Ratings",
 * table headers `Team,Rec,Δ,Rat,Pwr,HFA,SoS,SSF,EW,EL`, 350 teams).
 * Flat sports (`nfl`, `atp`, `wta`, `dlv`) use `/{sport}/ratings`.
 *
 * @see src/domain/sports.ts (repo sport ids / inventory buckets)
 */

export type MasseySportTarget = {
  /** Repo domain sport id / inventory bucket (e.g. 'volleyball'). */
  inventoryBucket: string;
  /** Massey sport code (e.g. 'cvol'). */
  masseySport: string;
  /** Massey subdivision path segment ('' for flat sports). */
  subdivision: string;
  /** Human label. */
  label: string;
};

/** Verified Massey targets. Extend as sport coverage is confirmed. */
export const MASSEY_SPORT_TARGETS: readonly MasseySportTarget[] = [
  // ── Volleyball ────────────────────────────────────────────────────────
  { inventoryBucket: 'volleyball', masseySport: 'cvol', subdivision: 'ncaa-d1', label: 'College Women Volleyball D1' },
  { inventoryBucket: 'volleyball', masseySport: 'cvol', subdivision: 'ncaa-d2', label: 'College Women Volleyball D2' },
  { inventoryBucket: 'volleyball', masseySport: 'cvol', subdivision: 'ncaa-d3', label: 'College Women Volleyball D3' },
  { inventoryBucket: 'volleyball', masseySport: 'cmvol', subdivision: 'ncaa-d1', label: 'College Men Volleyball D1' },
  { inventoryBucket: 'volleyball', masseySport: 'dlv', subdivision: '', label: 'Domestic Men Volleyball' },
  { inventoryBucket: 'volleyball', masseySport: 'dlvw', subdivision: '', label: 'Domestic Women Volleyball' },
  { inventoryBucket: 'volleyball', masseySport: 'csand', subdivision: '', label: 'Sand Volleyball' },
  // ── Basketball ────────────────────────────────────────────────────────
  { inventoryBucket: 'basketball', masseySport: 'cb', subdivision: 'ncaa-d1', label: 'College Men Basketball D1' },
  { inventoryBucket: 'basketball', masseySport: 'cbw', subdivision: 'ncaa-d1', label: 'College Women Basketball D1' },
  { inventoryBucket: 'basketball', masseySport: 'dlb', subdivision: '', label: 'Domestic Basketball' },
  // ── Football / American football ──────────────────────────────────────
  { inventoryBucket: 'american_football', masseySport: 'cf', subdivision: 'fbs', label: 'College Football FBS' },
  { inventoryBucket: 'american_football', masseySport: 'cf', subdivision: 'fcs', label: 'College Football FCS' },
  { inventoryBucket: 'american_football', masseySport: 'nfl', subdivision: '', label: 'NFL' },
  { inventoryBucket: 'american_football', masseySport: 'cfl', subdivision: '', label: 'CFL' },
  // ── Soccer ────────────────────────────────────────────────────────────
  { inventoryBucket: 'soccer', masseySport: 'dls', subdivision: '', label: 'Domestic Soccer' },
  { inventoryBucket: 'soccer', masseySport: 'csocw', subdivision: 'ncaa-d1', label: 'College Women Soccer D1' },
  // ── Tennis ────────────────────────────────────────────────────────────
  { inventoryBucket: 'tennis', masseySport: 'atp', subdivision: '', label: 'ATP' },
  { inventoryBucket: 'tennis', masseySport: 'wta', subdivision: '', label: 'WTA' },
  // ── Baseball ──────────────────────────────────────────────────────────
  { inventoryBucket: 'baseball', masseySport: 'mlb', subdivision: '', label: 'MLB' },
  { inventoryBucket: 'baseball', masseySport: 'cbase', subdivision: 'ncaa-d1', label: 'College Baseball D1' },
];

/** Full ratings URL for a target. */
export function masseyRatingsPath(target: MasseySportTarget): string {
  return target.subdivision
    ? `${target.masseySport}/${target.subdivision}/ratings`
    : `${target.masseySport}/ratings`;
}

/** All targets for a repo inventory bucket. */
export function masseyTargetsForBucket(bucket: string): MasseySportTarget[] {
  return MASSEY_SPORT_TARGETS.filter((t) => t.inventoryBucket === bucket);
}

/** Distinct inventory buckets covered by the registry. */
export function listMasseyBuckets(): string[] {
  return [...new Set(MASSEY_SPORT_TARGETS.map((t) => t.inventoryBucket))].sort();
}

/**
 * Resolve a user spec to a target:
 *   "cvol/ncaa-d1"   → exact masseySport/subdivision
 *   "volleyball"     → first target for the bucket
 *   "volleyball:ncaa-d2" → bucket + subdivision
 */
export function resolveMasseyTarget(spec: string): MasseySportTarget | undefined {
  const s = spec.trim();
  if (!s) return undefined;
  const slash = s.split('/');
  if (slash.length === 2) {
    const hit = MASSEY_SPORT_TARGETS.find(
      (t) => t.masseySport === slash[0] && t.subdivision === slash[1],
    );
    if (hit) return hit;
  }
  const colon = s.split(':');
  if (colon.length === 2) {
    const hit = MASSEY_SPORT_TARGETS.find(
      (t) => t.inventoryBucket === colon[0] && t.subdivision === colon[1],
    );
    if (hit) return hit;
  }
  return MASSEY_SPORT_TARGETS.find((t) => t.masseySport === s) ?? masseyTargetsForBucket(s)[0];
}
