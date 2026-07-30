/**
 * Player profiles read plane — serves the derived player_profiles table
 * (built by tools/tennis/build-player-profiles.ts from the events SSOT).
 * Read-only, failure-isolated: a missing DB/table degrades to "unavailable".
 */
// @see https://bun.com/docs/runtime/sqlite
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { DEFAULT_EVENT_STORE_DB } from "../institutions/event-store/paths.ts";

export type PlayerProfileView = {
  name: string;
  /** Nationality from research/seed/player-countries.json (null = unknown). */
  country: string | null;
  appearances: number;
  wins: number;
  losses: number;
  winRate: number | null;
  surfaces: Record<string, number>;
  avgKalshiVolume: number | null;
  lastSeenAt: string | null;
};

export type PlayerProfilesResult =
  | {
      state: "ok";
      count: number;
      players: PlayerProfileView[];
      /** warehouse = event-store derived; seed = fixture/unavailable path */
      profilesSource: "warehouse" | "seed";
    }
  | { state: "unavailable"; reason: string; profilesSource?: "seed" };

type Row = {
  player_name: string;
  country?: string | null;
  appearances: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  surfaces: string | null;
  avg_kalshi_volume_fp: number | null;
  last_seen_ts: number | null;
};

export function readPlayerProfiles(options: {
  limit?: number;
  /** Case-insensitive substring filter on player name. */
  search?: string;
  dbPath?: string;
  /** Default volume so "Top by volume" is real (P0). */
  sort?: "volume" | "appearances";
} = {}): PlayerProfilesResult {
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const sort = options.sort ?? "volume";
  if (!existsSync(dbPath)) {
    return {
      state: "unavailable",
      reason: "event store DB not found",
      profilesSource: "seed",
    };
  }
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const hasCountry = (db.query("PRAGMA table_info(player_profiles)").all() as Array<{ name: string }>)
      .some((c) => c.name === "country");
    const search = options.search?.trim();
    const orderBy =
      sort === "appearances"
        ? "appearances DESC, win_rate DESC"
        : "avg_kalshi_volume_fp DESC NULLS LAST, appearances DESC";
    const rows = db
      .query(
        `SELECT player_name, ${hasCountry ? "country, " : ""}appearances, wins, losses, win_rate, surfaces,
                avg_kalshi_volume_fp, last_seen_ts
         FROM player_profiles
         ${search ? "WHERE player_name LIKE ?" : ""}
         ORDER BY ${orderBy}
         LIMIT ?`,
      )
      .all(...(search ? [`%${search}%`, limit] : [limit])) as Row[];
    const now = Date.now();
    const players: PlayerProfileView[] = rows.map((r) => {
      let lastMs = r.last_seen_ts;
      // Cap future lastSeen (stale-coloring / clock skew)
      if (lastMs != null && lastMs > now) lastMs = now;
      return {
        name: r.player_name,
        country: r.country ?? null,
        appearances: r.appearances,
        wins: r.wins,
        losses: r.losses,
        winRate: r.win_rate,
        surfaces: r.surfaces ? (JSON.parse(r.surfaces) as Record<string, number>) : {},
        avgKalshiVolume: r.avg_kalshi_volume_fp,
        lastSeenAt: lastMs ? new Date(lastMs).toISOString() : null,
      };
    });
    return {
      state: "ok",
      count: players.length,
      players,
      profilesSource: "warehouse",
    };
  } catch (err) {
    return {
      state: "unavailable",
      reason:
        err instanceof Error ? err.message : "profiles unavailable — run bun run tennis:profiles:build",
      profilesSource: "seed",
    };
  } finally {
    db?.close();
  }
}
