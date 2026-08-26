// @see https://bun.com/docs/runtime/sqlite
/**
 * Build or rebuild player_opponent_profiles from existing events + markets.
 * Adds the opponent dimension player_profiles lacks: per-(player, opponent)
 * head-to-head matches, W/L, and average Kalshi market volume for the matchup.
 * Run after every sync (same cadence as build-player-profiles).
 *
 * Usage:
 *   bun tools/tennis/build-player-opponent-profiles.ts
 *   bun tools/tennis/build-player-opponent-profiles.ts --dry-run
 *   bun run tennis:profiles:opponents:build
 *
 * Volume: SQL_EVENT_VOLUME_FP (meta) — same resolve as player profiles.
 */
import { Database } from "bun:sqlite";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { parseArgs } from "node:util";
import {
  eventVolumeSqlForDb,
  roundVolumeFp,
} from "../../src/research/player-profile-meta.ts";

/** Record separator — never appears in player names; avoids NUL-key corruption. */
const PAIR_SEP = "\u001e";

type PairAgg = {
  player: string;
  opponent: string;
  matches: number;
  wins: number;
  losses: number;
  firstSeen: number;
  lastSeen: number;
  volumeFpSum: number;
  volumeFpCount: number;
};

function parseEventTs(startTs: string): number {
  const d = new Date(startTs);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function buildPlayerOpponentProfiles(
  db: Database,
  dryRun = false,
  nowMs = Date.now(),
): { pairsUpserted: number } {
  const agg = new Map<string, PairAgg>();

  const events = db.query(`
    SELECT event_id, player_a, player_b, winner, loser, start_ts
    FROM events
    WHERE corpus = 'trading'
  `).all() as Array<{
    event_id: string;
    player_a: string;
    player_b: string;
    winner: string;
    loser: string;
    start_ts: string;
  }>;

  const volumeByEvent = new Map<string, number>();
  const eventVolSql = eventVolumeSqlForDb(db);
  const volRows = db.query(`
    SELECT event_id, ${eventVolSql} as vol
    FROM markets
    GROUP BY event_id
  `).all() as Array<{ event_id: string; vol: number }>;
  for (const r of volRows) {
    if (r.vol > 0) volumeByEvent.set(r.event_id, r.vol);
  }

  for (const ev of events) {
    if (!ev.player_a || !ev.player_b) continue;
    const ts = parseEventTs(ev.start_ts);
    const vol = volumeByEvent.get(ev.event_id) ?? 0;

    for (const [player, opponent] of [
      [ev.player_a, ev.player_b],
      [ev.player_b, ev.player_a],
    ] as const) {
      const key = `${player}${PAIR_SEP}${opponent}`;
      let p = agg.get(key);
      if (!p) {
        p = {
          player,
          opponent,
          matches: 0,
          wins: 0,
          losses: 0,
          firstSeen: ts || nowMs,
          lastSeen: ts || nowMs,
          volumeFpSum: 0,
          volumeFpCount: 0,
        };
        agg.set(key, p);
      }
      p.matches++;
      if (ts > 0) {
        p.firstSeen = Math.min(p.firstSeen || ts, ts);
        p.lastSeen = Math.max(p.lastSeen, ts);
      }
      if (vol > 0) {
        p.volumeFpSum += vol;
        p.volumeFpCount++;
      }
      if (ev.winner === player) p.wins++;
      else if (ev.loser === player) p.losses++;
    }
  }

  for (const p of agg.values()) {
    if (p.lastSeen > nowMs) p.lastSeen = nowMs;
    if (p.firstSeen > nowMs) p.firstSeen = nowMs;
  }

  if (dryRun) {
    console.log(`Would upsert ${agg.size} player↔opponent profiles`);
    return { pairsUpserted: agg.size };
  }

  db.run("BEGIN");
  let upserted = 0;
  try {
    db.run("DELETE FROM player_opponent_profiles");

    const stmt = db.query(`
      INSERT INTO player_opponent_profiles (
        player_name, opponent_name, first_seen_ts, last_seen_ts,
        matches, wins, losses, win_rate, avg_kalshi_volume_fp, corpus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of agg.values()) {
      const winRate = p.matches > 0 ? p.wins / p.matches : null;
      const rawVol = p.volumeFpCount > 0 ? p.volumeFpSum / p.volumeFpCount : null;
      const avgVol = roundVolumeFp(rawVol);
      stmt.run(
        p.player,
        p.opponent,
        p.firstSeen,
        p.lastSeen,
        p.matches,
        p.wins,
        p.losses,
        winRate,
        avgVol,
        "trading",
      );
      upserted++;
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  return { pairsUpserted: upserted };
}

if (import.meta.main) {
  const { values: bpov } = parseArgs({ args: Bun.argv.slice(2), options: { 'dry-run': { type: 'boolean' } }, strict: false, allowPositionals: true });
const dryRun = bpov['dry-run'] === true;
  const db = openEventStore();
  const result = buildPlayerOpponentProfiles(db, dryRun);
  console.log(
    `Player↔opponent profiles: ${result.pairsUpserted} upserted` + (dryRun ? " (dry-run)" : ""),
  );
}
