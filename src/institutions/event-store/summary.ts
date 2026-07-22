// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import type { EventStoreSummaryRow } from "./types.ts";

export function summarizeEventsByTourSurfaceYear(db: Database): EventStoreSummaryRow[] {
  return db
    .query(
      `SELECT tour, surface, substr(start_ts, 1, 4) AS year, COUNT(*) AS count
       FROM events
       GROUP BY tour, surface, year
       ORDER BY tour, year DESC, surface, count DESC`,
    )
    .all() as EventStoreSummaryRow[];
}

export function countEvents(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number };
  return row.n;
}

export function countOddsTicks(db: Database): number {
  const row = db.query("SELECT COUNT(*) AS n FROM odds_ticks").get() as { n: number };
  return row.n;
}

export function formatEventStoreSummary(rows: EventStoreSummaryRow[]): string {
  if (rows.length === 0) return "No events in store.";
  const lines = ["Tour   Surface   Year   Count", "-----  --------  ----   -----"];
  for (const row of rows) {
    lines.push(
      `${row.tour.padEnd(5)}  ${row.surface.padEnd(8)}  ${row.year}   ${String(row.count).padStart(5)}`,
    );
  }
  return lines.join("\n");
}
