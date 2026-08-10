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
import { argValue, hasFlag } from "../src/cli/argv.ts";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  assertMatchLiquidityHealthy,
  recomputeMatchLiquidity,
} from "../src/institutions/event-store/match-liquidity.ts";

const dbPath = argValue("db") ?? DEFAULT_EVENT_STORE_DB;
const recompute = hasFlag("recompute");

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
      gates:
        "liquidity_ok = max(vol24h,vol_lifetime if vol24h=0)>=500 && spread_cents<=15 && quoted book && !crossed",
    },
    null,
    2,
  ),
);
