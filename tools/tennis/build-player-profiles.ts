// @see https://bun.com/docs/runtime/sqlite
/**
 * Build or rebuild player_profiles from existing events + markets (+ price_snapshots volume).
 * Run after every sync to keep profiles fresh.
 *
 * Usage:
 *   bun tools/tennis/build-player-profiles.ts
 *   bun tools/tennis/build-player-profiles.ts --dry-run
 *   bun run tennis:profiles:build   # package.json alias
 *
 * Volume ranking (P0): player_profiles.avg_kalshi_volume_fp ← avgKalshiVolumeFp meta.
 *   1) markets via SQL_MARKET_VOLUME_FP (volume_24h_fp > 0 else volume_fp)
 *   2) price_snapshots.kalshi_volume_24h per player via event join (when logger fills it)
 * Prefer the larger non-null source. Naming SSOT: src/research/player-profile-meta.ts
 */
import { Database } from "bun:sqlite";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  eventVolumeSqlForDb,
  roundVolumeFp,
  SNAPSHOT_SQL,
} from "../../src/research/player-profile-meta.ts";
import { countryForPlayer } from "../../src/research/tennis-meta.ts";
import { parseArgs } from "node:util";

const { values: bppv } = parseArgs({ args: Bun.argv.slice(2), options: { 'dry-run': { type: 'boolean' } }, strict: false, allowPositionals: true });
function arg(name: string): string | undefined {
  const v = bppv[name];
  return typeof v === 'string' ? v : undefined;
}

type SurfaceStats = { wins: number; losses: number; apps: number };

type PlayerAgg = {
  appearances: number;
  wins: number;
  losses: number;
  firstSeen: number;
  lastSeen: number;
  surfaces: Map<string, SurfaceStats>;
  volumeFpSum: number;
  volumeFpCount: number;
};

function parseEventTs(startTs: string): number {
  const d = new Date(startTs);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Average price_snapshots.kalshi_volume_24h per player (event join).
 * No poly_volume column — see player-profile-meta SNAPSHOT_SQL.
 */
export function loadVolumeMapFromPriceSnapshots(db: Database): Map<string, number> {
  const volumeMap = new Map<string, number>();
  const hasTable = db
    .query(
      `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='price_snapshots'`,
    )
    .get() as { ok: number } | null;
  if (!hasTable) return volumeMap;

  const cols = (
    db.query(`PRAGMA table_info(price_snapshots)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  const volCol = SNAPSHOT_SQL.kalshiVolume24h;
  if (!cols.includes(volCol)) return volumeMap;

  const sql = `
    SELECT name, AVG(avgVol) AS avgVol FROM (
      SELECT e.player_a AS name, s.${volCol} AS avgVol
      FROM price_snapshots s
      JOIN events e ON e.event_id = s.event_id
      WHERE s.${volCol} IS NOT NULL AND s.${volCol} > 0
        AND e.player_a IS NOT NULL AND e.player_a != ''
      UNION ALL
      SELECT e.player_b AS name, s.${volCol} AS avgVol
      FROM price_snapshots s
      JOIN events e ON e.event_id = s.event_id
      WHERE s.${volCol} IS NOT NULL AND s.${volCol} > 0
        AND e.player_b IS NOT NULL AND e.player_b != ''
    )
    GROUP BY name
  `;
  try {
    const rows = db.query(sql).all() as Array<{ name: string; avgVol: number }>;
    for (const row of rows) {
      if (row.name && Number.isFinite(row.avgVol) && row.avgVol > 0) {
        volumeMap.set(row.name, row.avgVol);
      }
    }
  } catch {
    /* column/join shape drift — markets path remains SSOT */
  }
  return volumeMap;
}

export function buildPlayerProfiles(db: Database, dryRun = false, nowMs = Date.now()): {
  playersUpserted: number;
  playersDeleted: number;
  volumeFromMarkets: number;
  volumeFromSnapshots: number;
  playersWithVolume: number;
  fillRate: number;
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

  // Per-event volume: match_winner legs × SQL_MARKET_VOLUME_FP (meta eventVolumeSqlForDb).
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

  const snapshotVol = loadVolumeMapFromPriceSnapshots(db);

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
          firstSeen: ts || nowMs,
          lastSeen: ts || nowMs,
          surfaces: new Map(),
          volumeFpSum: 0,
          volumeFpCount: 0,
        };
        agg.set(player, p);
      }
      p.appearances++;
      if (ts > 0) {
        p.firstSeen = Math.min(p.firstSeen || ts, ts);
        p.lastSeen = Math.max(p.lastSeen, ts);
      }
      p.surfaces.set(surf, (() => {
        const cur = p.surfaces.get(surf) ?? { wins: 0, losses: 0, apps: 0 };
        cur.apps++;
        if (ev.winner === player) cur.wins++;
        else if (ev.loser === player) cur.losses++;
        return cur;
      })());
      if (vol > 0) {
        p.volumeFpSum += vol;
        p.volumeFpCount++;
      }
      if (ev.winner === player) p.wins++;
      else if (ev.loser === player) p.losses++;
    }
  }

  // P1: never store future lastSeen (breaks stale coloring)
  for (const p of agg.values()) {
    if (p.lastSeen > nowMs) p.lastSeen = nowMs;
    if (p.firstSeen > nowMs) p.firstSeen = nowMs;
  }

  let volumeFromMarkets = 0;
  let volumeFromSnapshots = 0;
  for (const [name, p] of agg) {
    const fromMarkets = p.volumeFpCount > 0 ? p.volumeFpSum / p.volumeFpCount : null;
    const fromSnap = snapshotVol.get(name) ?? null;
    if (fromMarkets != null && fromMarkets > 0) volumeFromMarkets++;
    if (fromSnap != null && fromSnap > 0) volumeFromSnapshots++;
    // Markets are SSOT when present; snapshots only fill gaps (do not max-merge estimators).
    if (fromMarkets != null && fromMarkets > 0) {
      /* leave volumeFpSum / Count as market accumulation */
    } else if (fromSnap != null && fromSnap > 0) {
      p.volumeFpSum = fromSnap;
      p.volumeFpCount = 1;
    }
  }

  const playersWithVolume = [...agg.values()].filter(
    (p) => p.volumeFpCount > 0 && p.volumeFpSum > 0,
  ).length;
  const fillRate = agg.size > 0 ? playersWithVolume / agg.size : 0;

  if (dryRun) {
    // Preview top-by-volume without writing (operator check for non-zero ranking)
    const ranked = [...agg.entries()]
      .map(([name, p]) => ({
        name,
        avgVol: p.volumeFpCount > 0 ? Math.round((p.volumeFpSum / p.volumeFpCount) * 100) / 100 : 0,
        apps: p.appearances,
      }))
      .filter((r) => r.avgVol > 0)
      .sort((a, b) => b.avgVol - a.avgVol)
      .slice(0, 8);
    const fillPct = (fillRate * 100).toFixed(1);
    console.log(
      `Would upsert ${agg.size} player profiles · fill=${fillPct}% (${playersWithVolume}/${agg.size})` +
        ` · volume markets=${volumeFromMarkets} snapshots=${volumeFromSnapshots}`,
    );
    if (ranked.length > 0) {
      console.log("Top by volume (dry-run preview):");
      for (const r of ranked) {
        console.log(`  ${r.name.padEnd(28)} vol=${String(r.avgVol).padStart(12)} apps=${r.apps}`);
      }
    } else {
      console.log("Top by volume (dry-run preview): (none — markets/snapshots empty)");
    }
    return {
      playersUpserted: agg.size,
      playersDeleted: 0,
      volumeFromMarkets,
      volumeFromSnapshots,
      playersWithVolume,
      fillRate,
    };
  }

  db.run("BEGIN");
  let upserted = 0;
  try {
    // Wipe and rebuild — events table is SSOT, profiles are derived.
    db.run("DELETE FROM player_profiles");

    const stmt = db.query(`
      INSERT INTO player_profiles (
        player_name, first_seen_ts, last_seen_ts, appearances, wins, losses, win_rate,
        surfaces, avg_kalshi_volume_fp, corpus, country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [name, p] of agg) {
      const winRate = p.appearances > 0 ? p.wins / p.appearances : null;
      const rawVol = p.volumeFpCount > 0 ? p.volumeFpSum / p.volumeFpCount : null;
      const avgVol = roundVolumeFp(rawVol);
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
        countryForPlayer(name),
      );
      upserted++;
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  return {
    playersUpserted: upserted,
    playersDeleted: 0,
    volumeFromMarkets,
    volumeFromSnapshots,
    playersWithVolume,
    fillRate,
  };
}

if (import.meta.main) {
  const dryRun = bppv['dry-run'] === true;
  const db = openEventStore();
  const result = buildPlayerProfiles(db, dryRun);
  const fillPct = (result.fillRate * 100).toFixed(1);
  console.log(
    `Player profiles: ${result.playersUpserted} upserted` +
      (dryRun ? " (dry-run)" : "") +
      ` · fill=${fillPct}% (${result.playersWithVolume}/${result.playersUpserted})` +
      ` · volume markets=${result.volumeFromMarkets} snapshots=${result.volumeFromSnapshots}`,
  );
}
