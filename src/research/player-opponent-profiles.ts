/**
 * Player↔opponent profiles read plane — serves the derived
 * player_opponent_profiles table (built by
 * tools/tennis/build-player-opponent-profiles.ts from the events SSOT).
 * Read-only, failure-isolated: a missing DB/table degrades to "unavailable".
 */
// @see https://bun.com/docs/runtime/sqlite
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { DEFAULT_EVENT_STORE_DB } from "../institutions/event-store/paths.ts";

export type OpponentProfileView = {
  player: string;
  opponent: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgKalshiVolume: number | null;
  lastSeenAt: string | null;
};

export type OpponentProfilesResult =
  | { state: "ok"; count: number; pairs: OpponentProfileView[] }
  | { state: "unavailable"; reason: string };

type Row = {
  player_name: string;
  opponent_name: string;
  matches: number;
  wins: number;
  losses: number;
  win_rate: number | null;
  avg_kalshi_volume_fp: number | null;
  last_seen_ts: number | null;
};

function toView(r: Row): OpponentProfileView {
  return {
    player: r.player_name,
    opponent: r.opponent_name,
    matches: r.matches,
    wins: r.wins,
    losses: r.losses,
    winRate: r.win_rate,
    avgKalshiVolume: r.avg_kalshi_volume_fp,
    lastSeenAt: r.last_seen_ts ? new Date(r.last_seen_ts).toISOString() : null,
  };
}

export function readOpponentProfiles(options: {
  limit?: number;
  /** Case-insensitive substring filter on player name. */
  player?: string;
  /** Case-insensitive substring filter on opponent name. */
  opponent?: string;
  dbPath?: string;
} = {}): OpponentProfilesResult {
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  if (!existsSync(dbPath)) return { state: "unavailable", reason: "event store DB not found" };
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.player?.trim()) {
      clauses.push("player_name LIKE ?");
      params.push(`%${options.player.trim()}%`);
    }
    if (options.opponent?.trim()) {
      clauses.push("opponent_name LIKE ?");
      params.push(`%${options.opponent.trim()}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .query(
        `SELECT player_name, opponent_name, matches, wins, losses, win_rate,
                avg_kalshi_volume_fp, last_seen_ts
         FROM player_opponent_profiles
         ${where}
         ORDER BY matches DESC, avg_kalshi_volume_fp DESC
         LIMIT ?`,
      )
      .all(...params, limit) as Row[];
    const pairs = rows.map(toView);
    return { state: "ok", count: pairs.length, pairs };
  } catch (err) {
    return {
      state: "unavailable",
      reason:
        err instanceof Error
          ? err.message
          : "opponent profiles unavailable — run bun run tennis:profiles:opponents:build",
    };
  } finally {
    db?.close();
  }
}
