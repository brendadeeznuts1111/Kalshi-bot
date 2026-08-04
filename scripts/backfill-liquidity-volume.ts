#!/usr/bin/env bun
/**
 * Network: backfill markets.volume_* for quoted zero-vol match_liquidity rows.
 *
 *   bun run liquidity:backfill-volume
 *   bun run liquidity:backfill-volume -- --limit=40
 */
import { parseArgs } from "node:util";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { recomputeMatchLiquidity } from "../src/institutions/event-store/match-liquidity.ts";
import { backfillQuotedMarketVolumes } from "../src/institutions/event-store/match-liquidity-backfill.ts";
import { summarizeMatchLiquidity } from "../src/institutions/event-store/match-liquidity.ts";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    db: { type: "string" },
    limit: { type: "string" },
    json: { type: "boolean", default: false },
  },
  strict: false,
});

const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
const limit = values.limit ? Number(values.limit) : 80;
const db = openEventStore({ dbPath });
// Ensure match_liquidity exists for join
recomputeMatchLiquidity(db);
const result = await backfillQuotedMarketVolumes(db, {
  limit: Number.isFinite(limit) ? limit : 80,
});
const summary = summarizeMatchLiquidity(db);
if (values.json) {
  console.log(JSON.stringify({ result, summary }, null, 2));
} else {
  console.log(
    `backfill: candidates=${result.candidates} fetched=${result.fetched} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`,
  );
  console.log(
    `match_liquidity: total=${summary.total} quoted=${summary.quoted} liq_ok=${summary.liquidityOk} tradable=${summary.tradable}`,
  );
}
