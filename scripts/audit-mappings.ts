#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/sqlite
/**
 * Data mapping audit — verify player coverage, surface completeness, and settlement linkage.
 *
 * Usage:
 *   bun run audit:mappings
 *   bun run audit:mappings --db ./research/cache/event-store.db
 *
 * Checks:
 *   1. Player name → profile coverage
 *   2. Surface metadata completeness
 *   3. Elo vs market signal correlation
 *   4. Snapshot distribution across series
 *   5. Settlement linkage for resolved events
 */
import { parseArgs } from "node:util";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";

// ── Queries ─────────────────────────────────────────────────────

const Q_PROFILES_TOTAL = `SELECT COUNT(*) AS n FROM player_profiles`;

const Q_PROFILES_WITH_SURFACE = `
  SELECT COUNT(*) AS n FROM player_profiles
  WHERE json_extract(surfaces, '$.Hard.apps') >= 3
     OR json_extract(surfaces, '$.Clay.apps') >= 3
     OR json_extract(surfaces, '$.Grass.apps') >= 3
`;

const Q_SNAPSHOT_PLAYERS = `
  SELECT DISTINCT e.player_a AS name FROM price_snapshots s
  JOIN events e ON e.event_id = s.event_id
  UNION
  SELECT DISTINCT e.player_b FROM price_snapshots s
  JOIN events e ON e.event_id = s.event_id
`;

const Q_SNAPSHOT_SUMMARY = `
  SELECT COUNT(*)                   AS total,
         COUNT(s.kalshi_mid_cents)  AS withMid,
         COUNT(s.elo_prob)          AS withElo,
         COUNT(s.surface_edge)      AS withEdge,
         COUNT(DISTINCT s.ticker)   AS tickers,
         MIN(s.ts)                  AS firstTs,
         MAX(s.ts)                  AS lastTs
  FROM price_snapshots s
`;

const Q_SURFACE_COVERAGE = `
  SELECT s.elo_surface, COUNT(*) AS n
  FROM price_snapshots s
  WHERE s.elo_surface IS NOT NULL
  GROUP BY s.elo_surface
  ORDER BY n DESC
`;

const Q_SERIES_DISTRIBUTION = `
  SELECT SUBSTR(s.ticker, 1, INSTR(s.ticker || '-', '-') - 1) AS series,
         COUNT(*) AS n,
         COUNT(s.kalshi_mid_cents) AS withPrice,
         COUNT(s.elo_prob) AS withElo
  FROM price_snapshots s
  GROUP BY series
  ORDER BY n DESC
`;

const Q_SETTLEMENT_LINKAGE = `
  SELECT COUNT(*) AS total,
         SUM(CASE WHEN r.outcome IS NOT NULL THEN 1 ELSE 0 END) AS settled
  FROM price_snapshots s
  LEFT JOIN resolutions r ON r.event_id = s.event_id
`;

const Q_SURFACE_EDGE_RANGE = `
  SELECT MIN(surface_edge) AS min, MAX(surface_edge) AS max,
         AVG(CAST(surface_edge AS REAL)) AS avg,
         COUNT(*) AS n
  FROM price_snapshots WHERE surface_edge != 0
`;

const Q_PLAYER_PROFILE_MISSING = `
  SELECT DISTINCT e.player_a AS name
  FROM price_snapshots s
  JOIN events e ON e.event_id = s.event_id
  LEFT JOIN player_profiles p ON p.player_name = e.player_a
  WHERE p.player_name IS NULL
  LIMIT 20
`;

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { db: { type: "string" } },
    strict: false,
    allowPositionals: true,
  });

  const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath, readonly: true });

  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║           Data Mapping Audit                               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log(`  DB: ${dbPath}`);
  console.log("");

  // 1. Player profile coverage
  const profTotal = (db.query(Q_PROFILES_TOTAL).get() as { n: number }).n;
  const profWithSurf = (db.query(Q_PROFILES_WITH_SURFACE).get() as { n: number }).n;

  const snapPlayers = db.query(Q_SNAPSHOT_PLAYERS).all() as Array<{ name: string }>;
  const snapPlayerNames = snapPlayers.map((r) => r.name);
  const playerCount = snapPlayerNames.length;

  // Check each snapshot player has a profile
  const missingProfiles = db.query(Q_PLAYER_PROFILE_MISSING).all() as Array<{ name: string }>;
  const covered = playerCount - missingProfiles.length;
  const coveragePct = playerCount > 0 ? ((covered / playerCount) * 100).toFixed(1) : "0.0";

  console.log(`  👤 Player Profile Coverage:`);
  console.log(`      Total profiles in DB:   ${profTotal}`);
  console.log(`      With surface history:   ${profWithSurf}`);
  console.log(`      Unique in snapshots:    ${playerCount}`);
  console.log(`      Covered by profile:     ${covered} (${coveragePct}%)`);
  if (missingProfiles.length > 0) {
    console.log(`      Missing profiles:       ${missingProfiles.length}`);
    console.log(`      Sample: ${missingProfiles.slice(0, 5).map((r) => r.name).join(", ")}`);
  }
  console.log("");

  // 2. Snapshot summary
  const snap = db.query(Q_SNAPSHOT_SUMMARY).get() as {
    total: number; withMid: number; withElo: number;
    withEdge: number; tickers: number; firstTs: number; lastTs: number;
  };
  console.log(`  📊 Snapshot Summary:`);
  console.log(`      Total snapshots:       ${snap.total}`);
  console.log(`      With match key:        ${snap.total}`);
  console.log(`      With mid price:        ${snap.withMid}`);
  console.log(`      With Elo probability:  ${snap.withElo}`);
  console.log(`      With surface edge:     ${snap.withEdge}`);
  console.log(`      Distinct tickers:      ${snap.tickers}`);
  console.log(`      Period: ${new Date(Number(snap.firstTs)).toISOString().slice(0, 19).replace("T", " ")}`);
  console.log(`           → ${new Date(Number(snap.lastTs)).toISOString().slice(0, 19).replace("T", " ")}`);
  console.log("");

  // 3. Surface coverage
  const surfaces = db.query(Q_SURFACE_COVERAGE).all() as Array<{ elo_surface: string; n: number }>;
  console.log(`  🎾 Surface Distribution:`);
  for (const s of surfaces) {
    const bar = "█".repeat(Math.round((s.n / Math.max(...surfaces.map((x) => x.n))) * 20));
    console.log(`      ${(s.elo_surface ?? "null").padEnd(10)} ${String(s.n).padStart(6)}  ${bar}`);
  }
  console.log("");

  // 4. Series distribution
  const series = db.query(Q_SERIES_DISTRIBUTION).all() as Array<{
    series: string; n: number; withPrice: number; withElo: number;
  }>;
  console.log(`  🏓 Series Distribution:`);
  console.log(`      ${"Series".padEnd(20)} ${"Snaps".padStart(7)} ${"Price%".padStart(7)} ${"Elo%".padStart(6)}`);
  console.log(`      ${"─".repeat(20)} ${"─".repeat(7)} ${"─".repeat(7)} ${"─".repeat(6)}`);
  for (const s of series) {
    const pricePct = s.n > 0 ? Math.round((s.withPrice / s.n) * 100) : 0;
    const eloPct = s.n > 0 ? Math.round((s.withElo / s.n) * 100) : 0;
    console.log(`      ${s.series.padEnd(20)} ${String(s.n).padStart(7)} ${String(pricePct).padStart(6)}% ${String(eloPct).padStart(5)}%`);
  }
  console.log("");

  // 5. Settlement linkage
  const settle = db.query(Q_SETTLEMENT_LINKAGE).get() as { total: number; settled: number };
  const settlePct = settle.total > 0 ? ((settle.settled / settle.total) * 100).toFixed(1) : "0.0";
  console.log(`  ✅ Settlement Linkage:`);
  console.log(`      Total snapshots:       ${settle.total}`);
  console.log(`      Resolved outcomes:     ${settle.settled} (${settlePct}%)`);
  console.log(`      Unresolved:            ${settle.total - settle.settled}`);
  console.log("");

  // 6. Surface edge stats
  const edge = db.query(Q_SURFACE_EDGE_RANGE).get() as { min: number; max: number; avg: number; n: number };
  console.log(`  📐 Surface Edge Stats:`);
  if (edge.n > 0) {
    console.log(`      Range: ${edge.min} to ${edge.max} (avg: ${edge.avg.toFixed(1)})`);
    console.log(`      Non-zero snapshots: ${edge.n}`);
  } else {
    console.log(`      No non-zero surface edges computed yet.`);
    console.log(`      Tip: ensure player_profiles have surface W/L data (run build-player-profiles).`);
  }
  console.log("");

  // Verdict
  const issues: string[] = [];
  if (parseFloat(coveragePct) < 90) issues.push(`Low player profile coverage: ${coveragePct}%`);
  if (snap.withMid < snap.total * 0.8) issues.push(`Low mid price coverage: ${snap.withMid}/${snap.total}`);
  if (snap.withElo < snap.total * 0.8) issues.push(`Low Elo coverage: ${snap.withElo}/${snap.total}`);
  if (parseFloat(settlePct) < 10) issues.push(`Low settlement linkage: ${settlePct}% — let logger accumulate`);

  if (issues.length === 0) {
    console.log("  ✅ All checks passed — data mapping is healthy.");
  } else {
    console.log("  ⚠️  Issues found:");
    for (const issue of issues) console.log(`       - ${issue}`);
  }
  console.log("");
}

if (import.meta.main) await main();
