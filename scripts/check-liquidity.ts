#!/usr/bin/env bun
/**
 * Proof gate for match_liquidity schema + desk gates (offline).
 *
 * Usage:
 *   bun run check:liquidity
 *   bun scripts/check-liquidity.ts -- --db=/path/to/event-store.db
 *   bun scripts/check-liquidity.ts -- --recompute
 *
 * Does not hit network. Prefer unit suite for aggregation correctness.
 */
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  assertMatchLiquidityHealthy,
  recomputeMatchLiquidity,
} from "../src/institutions/event-store/match-liquidity.ts";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("-") ? v : undefined;
}

const dbPath =
  argValue("--db") ??
  process.argv.find((a) => a.startsWith("--db="))?.slice("--db=".length) ??
  DEFAULT_EVENT_STORE_DB;
const recompute = process.argv.includes("--recompute");

const db = openEventStore({ dbPath });
if (recompute) {
  const n = recomputeMatchLiquidity(db);
  console.log(`recompute: wrote ${n} match_liquidity row(s)`);
}
const health = assertMatchLiquidityHealthy(db);
console.log(
  JSON.stringify(
    {
      ok: true,
      dbPath,
      table: health.table,
      rowCount: health.rowCount,
      gates: "liquidity_ok = volume_24h>=500 && spread_cents<=15 && !crossed",
    },
    null,
    2,
  ),
);
