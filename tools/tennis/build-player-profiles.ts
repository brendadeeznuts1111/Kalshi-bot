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
 * Volume ranking (P0): avg_kalshi_volume_fp is populated from:
 *   1) markets volume_24h_fp / volume_fp per event (primary when present)
 *   2) price_snapshots.kalshi_volume_24h averaged per player via event join (when logger fills it)
 * Prefer the larger non-null source so "Top by volume" is not stuck at 0.
 */
import { Database } from "bun:sqlite";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { countryForPlayer } from "../../src/research/tennis-meta.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
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
 * Prefer price_history (price_snapshots) avg volume per player when present.
 * Schema has kalshi_volume_24h (no poly_volume column in event-store today).
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
  const volCol = cols.includes("kalshi_volume_24h")
    ? "kalshi_volume_24h"
    : cols.includes("poly_volume")
      ? "poly_volume"
      : null;
  if (!volCol) return volumeMap;

  // Average snapshot volume for each side of the event.
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

  // Pre-fetch volume per event from markets (24h preferred when > 0, else lifetime volume_fp).
  // Note: Kalshi often stores volume_24h_fp as "0.00" — do not let that mask volume_fp.
  const volumeByEvent = new Map<string, number>();
  const volRows = db.query(`
    SELECT event_id,
           COALESCE(SUM(
             CASE
               WHEN CAST(COALESCE(NULLIF(volume_24h_fp, ''), '0') AS REAL) > 0
                 THEN CAST(volume_24h_fp AS REAL)
               ELSE CAST(COALESCE(NULLIF(volume_fp, ''), '0') AS REAL)
             END
           ), 0) as vol
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
    // Prefer the stronger positive signal so ranking is not cosmetic zeros
    if (fromMarkets != null && fromSnap != null) {
      p.volumeFpSum = Math.max(fromMarkets, fromSnap);
      p.volumeFpCount = 1;
    } else if (fromSnap != null && fromSnap > 0 && (fromMarkets == null || fromMarkets <= 0)) {
      p.volumeFpSum = fromSnap;
      p.volumeFpCount = 1;
    }
  }

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
    console.log(
      `Would upsert ${agg.size} player profiles · volume markets=${volumeFromMarkets} snapshots=${volumeFromSnapshots}`,
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
      // Round to 2 dp so JSON/UI ranks stay stable (avoids 2016990.8900000001)
      const avgVol = rawVol != null && Number.isFinite(rawVol) ? Math.round(rawVol * 100) / 100 : null;
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
  };
}

if (import.meta.main) {
  const dryRun = Bun.argv.includes("--dry-run");
  const db = openEventStore();
  const result = buildPlayerProfiles(db, dryRun);
  console.log(
    `Player profiles: ${result.playersUpserted} upserted` +
      (dryRun ? " (dry-run)" : "") +
      ` · volume markets=${result.volumeFromMarkets} snapshots=${result.volumeFromSnapshots}`,
  );
}
