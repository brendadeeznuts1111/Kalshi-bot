/**
 * Player-profile meta contract — single naming SSOT for volume + recency.
 *
 * Layers:
 *   SQLite (event-store)  → snake_case columns below
 *   Interior / JSON API   → camelCase with unit suffixes (Fp / AtMs)
 *   HQ UI                 → formats AtMs → date; never invents alternate keys
 *
 * Forbidden aliases (do not reintroduce):
 *   avgVolume, avgVolumeFp (on profiles), avgKalshiVolume (missing Fp),
 *   lastSeenMs, lastSeenAt as a number, poly_volume, price_history.db
 *
 * @see docs/PLAYER_PROFILES_META.md
 * @see docs/GLOSSARY.md (UNITS: countFp, atMs)
 */

/** Where profile rows came from. */
export type ProfilesSource = "warehouse" | "seed";

/**
 * SQLite column names on player_profiles / player_opponent_profiles.
 * last_seen_ts is epoch **milliseconds** (event-store convention), not Kalshi
 * wire unix-seconds — document any conversion at external boundaries only.
 */
export const PROFILE_SQL = {
  avgKalshiVolumeFp: "avg_kalshi_volume_fp",
  lastSeenTs: "last_seen_ts",
  firstSeenTs: "first_seen_ts",
} as const;

/**
 * markets volume resolve: prefer trailing 24h when > 0, else lifetime.
 * Kalshi often stores volume_24h_fp as "0.00" — that must not mask volume_fp.
 */
export const SQL_MARKET_VOLUME_FP = `
  CASE
    WHEN CAST(COALESCE(NULLIF(volume_24h_fp, ''), '0') AS REAL) > 0
      THEN CAST(volume_24h_fp AS REAL)
    ELSE CAST(COALESCE(NULLIF(volume_fp, ''), '0') AS REAL)
  END
`.trim();

/** price_snapshots column written by the price-logger (resolved REAL, not wire TEXT). */
export const SNAPSHOT_SQL = {
  kalshiVolume24h: "kalshi_volume_24h",
  kalshiOpenInterest: "kalshi_open_interest",
} as const;

/** Interior + JSON shape for one player's volume/recency (profiles API). */
export type ProfileVolumeFields = {
  /** Mean resolved market volume across trading appearances; null = no volume data. */
  avgKalshiVolumeFp: number | null;
  /** Epoch millis of latest event start; null unknown; never future after cap. */
  lastSeenAtMs: number | null;
};

/** Cap a last-seen clock to now (stale coloring / clock skew). */
export function capLastSeenAtMs(
  ms: number | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return ms > nowMs ? nowMs : ms;
}

/** Round stored averages so ranks stay stable (2 dp). */
export function roundVolumeFp(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100) / 100;
}

/** ISO date for UI only — not a JSON contract field. */
export function formatLastSeenDate(ms: number | null | undefined): string | null {
  const capped = capLastSeenAtMs(ms ?? null);
  return capped != null ? new Date(capped).toISOString().slice(0, 10) : null;
}
