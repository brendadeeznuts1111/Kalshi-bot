/**
 * hq-store.ts — HQ trading snapshot persistence (bun:sqlite).
 *
 * Every successful trading fetch appends a snapshot; the Trading tab charts
 * balance / portfolio value / exposure over time from this history.
 * DB lives under research/cache (writable, gitignored family).
 */
import { Database } from "bun:sqlite";
import { joinPath, CACHE_DIR } from "./paths.ts";
import type { NormalizedPosition } from "../institutions/ledger-types.ts";

export const HQ_STORE_DB = joinPath(CACHE_DIR, "hq-store.db");

/** Min spacing between recorded snapshots — refreshes within a minute share one row. */
const MIN_SNAPSHOT_SPACING_MS = 60_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS trading_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  balance_cents INTEGER,
  portfolio_value_cents INTEGER,
  exposure_cents INTEGER,
  position_count INTEGER NOT NULL DEFAULT 0,
  open_order_count INTEGER NOT NULL DEFAULT 0,
  fill_count INTEGER NOT NULL DEFAULT 0,
  positions_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_trading_snapshots_at ON trading_snapshots(at_ms);
`;

let db: Database | null = null;

export function openHqStore(path: string = HQ_STORE_DB): Database {
  if (db) return db;
  db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

/** Test hook — reset the memoized connection. */
export function closeHqStore(): void {
  db?.close();
  db = null;
}

export type TradingSnapshotInput = {
  atMs: number;
  balanceCents: number | null;
  portfolioValueCents: number | null;
  positions: NormalizedPosition[];
  openOrderCount: number;
  fillCount: number;
};

function totalExposureCents(positions: NormalizedPosition[]): number | null {
  let sum = 0;
  let any = false;
  for (const p of positions) {
    if (p.exposureCents != null) {
      sum += Math.abs(p.exposureCents);
      any = true;
    }
  }
  return any ? sum : null;
}

export function recordTradingSnapshot(input: TradingSnapshotInput, store?: Database): void {
  const d = store ?? openHqStore();
  const last = d.query("SELECT MAX(at_ms) AS m FROM trading_snapshots").get() as { m: number | null };
  if (last.m != null && input.atMs - last.m < MIN_SNAPSHOT_SPACING_MS) return;
  d.query(
    `INSERT INTO trading_snapshots
     (at_ms, balance_cents, portfolio_value_cents, exposure_cents, position_count, open_order_count, fill_count, positions_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.atMs,
    input.balanceCents,
    input.portfolioValueCents,
    totalExposureCents(input.positions),
    input.positions.length,
    input.openOrderCount,
    input.fillCount,
    JSON.stringify(input.positions),
  );
}

export type TradingSnapshotRow = {
  atMs: number;
  balanceCents: number | null;
  portfolioValueCents: number | null;
  exposureCents: number | null;
  positionCount: number;
  openOrderCount: number;
  fillCount: number;
};

export function readTradingHistory(limit = 200, store?: Database): TradingSnapshotRow[] {
  try {
    const d = store ?? openHqStore();
    const rows = d
      .query(
        `SELECT at_ms, balance_cents, portfolio_value_cents, exposure_cents,
                position_count, open_order_count, fill_count
         FROM trading_snapshots ORDER BY at_ms DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, number | null>>;
    return rows
      .map((r) => ({
        atMs: r.at_ms as number,
        balanceCents: r.balance_cents!,
        portfolioValueCents: r.portfolio_value_cents!,
        exposureCents: r.exposure_cents!,
        positionCount: (r.position_count as number) ?? 0,
        openOrderCount: (r.open_order_count as number) ?? 0,
        fillCount: (r.fill_count as number) ?? 0,
      }))
      .reverse(); // chronological for charting
  } catch {
    return [];
  }
}
