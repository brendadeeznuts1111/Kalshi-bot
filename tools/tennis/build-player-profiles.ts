// @see https://bun.com/docs/runtime/sqlite
/**
 * Build or rebuild player_profiles from existing events + markets.
 * Run after every sync to keep profiles fresh.
 *
 * Usage:
 *   bun tools/tennis/build-player-profiles.ts
 *   bun tools/tennis/build-player-profiles.ts --dry-run
 */
import { Database } from "bun:sqlite";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

type PlayerAgg = {
  appearances: number;
  wins: number;
  losses: number;
  firstSeen: number;
  lastSeen: number;
  surfaces: Map<string, number>;
  volumeFpSum: number;
  volumeFpCount: number;
};

function parseEventTs(startTs: string): number {
  const d = new Date(startTs);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function buildPlayerProfiles(db: Database, dryRun = false): {
  playersUpserted: number;
  playersDeleted: number;
} {
  const agg = new Map<string, PlayerAgg>();

  // Aggregate from events table
  const events = db.query(`
    SELECT event_id, player_a, player_b, winner, loser, start_ts, surface, outcome
    FROM events
    WHERE corpus = 'trading'
  `).all() as Array<{
    event_id: string;
    player_a: string;
    player_b: string;
    winner: string;
    loser: string;
    start_ts: string;
    surface: string;
    outcome: string;
  }>;

  // Pre-fetch volume per event from markets
  const volumeByEvent = new Map<string, number>();
  const volRows = db.query(`
    SELECT event_id,
           COALESCE(SUM(CAST(volume_fp AS REAL)), 0) as vol
    FROM markets
    WHERE volume_fp IS NOT NULL
    GROUP BY event_id
  `).all() as Array<{ event_id: string; vol: number }>;
  for (const r of volRows) {
    volumeByEvent.set(r.event_id, r.vol);
  }

  for (const ev of events) {
    const ts = parseEventTs(ev.start_ts);
    const surf = ev.surface || "unknown";
    const vol = volumeByEvent.get(ev.event_id) ?? 0;

    for (const player of [ev.player_a, ev.player_b]) {
      if (!player) continue;
      let p = agg.get(player);
      if (!p) {
        p = {
          appearances: 0,
          wins: 0,
          losses: 0,
          firstSeen: ts,
          lastSeen: ts,
          surfaces: new Map(),
          volumeFpSum: 0,
          volumeFpCount: 0,
        };
        agg.set(player, p);
      }
      p.appearances++;
      p.firstSeen = Math.min(p.firstSeen, ts);
      p.lastSeen = Math.max(p.lastSeen, ts);
      p.surfaces.set(surf, (p.surfaces.get(surf) ?? 0) + 1);
      if (vol > 0) {
        p.volumeFpSum += vol;
        p.volumeFpCount++;
      }
      if (ev.winner === player) p.wins++;
      else if (ev.loser === player) p.losses++;
    }
  }

  if (dryRun) {
    console.log(`Would upsert ${agg.size} player profiles`);
    return { playersUpserted: agg.size, playersDeleted: 0 };
  }

  db.run("BEGIN");
  let upserted = 0;
  try {
    // Wipe and rebuild — events table is SSOT, profiles are derived.
    db.run("DELETE FROM player_profiles");

    const stmt = db.query(`
      INSERT INTO player_profiles (
        player_name, first_seen_ts, last_seen_ts, appearances, wins, losses, win_rate,
        surfaces, avg_kalshi_volume_fp, corpus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [name, p] of agg) {
      const winRate = p.appearances > 0 ? p.wins / p.appearances : null;
      const avgVol = p.volumeFpCount > 0 ? p.volumeFpSum / p.volumeFpCount : null;
      const surfacesObj = Object.fromEntries(p.surfaces);
      stmt.run(
        name,
        p.firstSeen,
        p.lastSeen,
        p.appearances,
        p.wins,
        p.losses,
        winRate,
        JSON.stringify(surfacesObj),
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

  return { playersUpserted: upserted, playersDeleted: 0 };
}

if (import.meta.main) {
  const dryRun = Bun.argv.includes("--dry-run");
  const db = openEventStore();
  const result = buildPlayerProfiles(db, dryRun);
  console.log(
    `Player profiles: ${result.playersUpserted} upserted` +
      (dryRun ? " (dry-run)" : ""),
  );
}
