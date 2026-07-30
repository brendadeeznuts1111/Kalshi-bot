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

/** Per-surface W/L stored in player_profiles.surfaces JSON. */
export type SurfaceStats = { wins: number; losses: number; apps: number };

/**
 * Parse surfaces JSON from SQLite.
 * Accepts nested SurfaceStats (current) or legacy Record&lt;surface, apps count&gt;.
 */
export function parseSurfaceStats(
  raw: string | null | undefined,
): Record<string, SurfaceStats> {
  if (!raw?.trim()) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, SurfaceStats> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v != null && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        const apps = Number(o.apps ?? 0) || 0;
        const wins = Number(o.wins ?? 0) || 0;
        const losses = Number(o.losses ?? 0) || 0;
        out[k] = { apps, wins, losses };
      } else if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = { apps: v, wins: 0, losses: 0 };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** HQ/table display: "hard 3 (2–1) · clay 1 (0–1)". */
export function formatSurfacesDisplay(surfaces: Record<string, SurfaceStats | number>): string {
  return Object.entries(surfaces)
    .map(([k, v]) => {
      if (typeof v === "number") return `${k} ${v}`;
      const apps = v.apps || v.wins + v.losses || 0;
      if (v.wins + v.losses > 0) return `${k} ${apps} (${v.wins}–${v.losses})`;
      return `${k} ${apps}`;
    })
    .join(" · ");
}

/**
 * Per-event volume SQL: match_winner legs only, SUM of resolved vol.
 * (Two match_winner tickers = both sides' contract volume, not double-count of one book.)
 * When `market_kind` column is absent (minimal test DBs), omit the kind filter.
 */
export const SQL_EVENT_VOLUME_FP = `
  COALESCE(SUM(
    CASE
      WHEN market_kind IS NULL OR market_kind = '' OR market_kind = 'match_winner'
        THEN (${SQL_MARKET_VOLUME_FP})
      ELSE 0
    END
  ), 0)
`.trim();

/** Fallback when markets has no market_kind column. */
export const SQL_EVENT_VOLUME_FP_NO_KIND = `
  COALESCE(SUM(${SQL_MARKET_VOLUME_FP}), 0)
`.trim();

function marketsColumnNames(db: {
  query: (sql: string) => { all: () => Array<{ name: string }> };
}): string[] {
  try {
    return db.query(`PRAGMA table_info(markets)`).all().map((c) => c.name);
  } catch {
    return [];
  }
}

/** Per-market resolve SQL adapted to available columns (test DBs may omit 24h). */
export function marketVolumeSqlForDb(db: {
  query: (sql: string) => { all: () => Array<{ name: string }> };
}): string {
  const cols = marketsColumnNames(db);
  if (cols.includes("volume_24h_fp") && cols.includes("volume_fp")) return SQL_MARKET_VOLUME_FP;
  if (cols.includes("volume_fp")) {
    return `CAST(COALESCE(NULLIF(volume_fp, ''), '0') AS REAL)`;
  }
  if (cols.includes("volume_24h_fp")) {
    return `CAST(COALESCE(NULLIF(volume_24h_fp, ''), '0') AS REAL)`;
  }
  return `0`;
}

/** Pick event-volume SQL fragment for the live schema. */
export function eventVolumeSqlForDb(db: {
  query: (sql: string) => { all: () => Array<{ name: string }> };
}): string {
  const cols = marketsColumnNames(db);
  const perMarket = marketVolumeSqlForDb(db);
  if (cols.includes("market_kind")) {
    return `
  COALESCE(SUM(
    CASE
      WHEN market_kind IS NULL OR market_kind = '' OR market_kind = 'match_winner'
        THEN (${perMarket})
      ELSE 0
    END
  ), 0)
`.trim();
  }
  return `COALESCE(SUM(${perMarket}), 0)`;
}
