#!/usr/bin/env bun
/**
 * Inventory sync — stream events → skin_events (coverage catalog, not seat-partner).
 *
 * Discovers new stream inventory_ids; optional --enrich-booked soft-matches
 * Statscore names → odds_event_id (metadata only, not odds).
 *
 * Usage:
 *   bun run inventory:sync -- --sport=all --once
 *   bun run inventory:sync -- --sport=all --dry-run
 *   bun run inventory:sync -- --sport=all --dry-run --json
 *   bun run inventory:sync -- --sport=all --loop --interval-ms=30000
 *   bun run inventory:sync -- --sport=table_tennis --once
 *   bun run inventory:sync -- --enrich-booked --json
 *   bun run inventory:sync -- --enrich-booked --enrich-scope=board
 *   bun run inventory:sync -- --enrich-booked --enrich-scope=unlinked
 *   bun run inventory:sync -- --odds-status
 *
 * Default sport filter when omitted: table_tennis (CLI). Cron defaults to all.
 * --dry-run: fetch + plan insert/update only (no SQLite writes; enrich is planned only).
 *            Incompatible with --loop.
 * --enrich-scope: new | board (default) | unlinked
 * --odds-status: odds_event_id fill-rate only (no poll)
 */
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  getFantasySessionAdapter,
  loadFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromEnv,
} from "../src/partner/index.ts";
import {
  formatOddsLinkCoverage,
  formatSyncReport,
  oddsLinkCoverage,
  parseEnrichBookedScope,
  runInventorySync,
} from "../src/inventory/sync.ts";
import { buckeyeInventoryIdentity } from "../src/inventory/skin-events-store.ts";
import { requireDefaultUrlForUltraMapper } from "../src/domain/index.ts";
import type { PartnerAccountProfile } from "../src/partner/account-profile.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function resolveProfile(dryRun: boolean): PartnerAccountProfile {
  if (!dryRun) {
    return requireFantasy402ProfileFromEnv();
  }
  // Dry-run: prefer real env, else public dummy when inventory is public-only
  const fromEnv = loadFantasy402ProfileFromEnv();
  if (fromEnv) return fromEnv;
  if (Bun.env.INVENTORY_SYNC_PUBLIC === "1" || Bun.env.PARTNER_SYNC_PUBLIC === "1") {
    return {
      id: "fantasy402-public",
      partner: "fantasy402",
      url: requireDefaultUrlForUltraMapper(),
      status: "active",
      defaultLiveProduct: 2,
      meta: {
        customerID: "public",
        agentID: "public",
        password: "public",
        token: "public",
        currency: "USD",
      },
    };
  }
  return requireFantasy402ProfileFromEnv();
}

async function runOnce(options: {
  dryRun: boolean;
  sport: string;
  enrichBooked: boolean;
  enrichBookedScope: ReturnType<typeof parseEnrichBookedScope>;
  json: boolean;
}): Promise<void> {
  const profile = resolveProfile(options.dryRun);
  const adapter = getFantasySessionAdapter(profile, { warmSession: false });
  // Optional login — inventory works without it
  try {
    await adapter.login();
  } catch {
    /* continue */
  }

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  const report = await runInventorySync(db, adapter, {
    sport: options.sport,
    enrichBooked: options.enrichBooked,
    enrichBookedScope: options.enrichBookedScope,
    dryRun: options.dryRun,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatSyncReport(report));
  }
}

async function main(): Promise<void> {
  const loop = hasFlag("loop");
  const dryRun = hasFlag("dry-run") || hasFlag("dryRun");
  const json = hasFlag("json");
  const intervalMs = Math.max(
    Number(argValue("interval-ms") ?? "30000") || 30_000,
    5_000,
  );

  if (hasFlag("odds-status")) {
    const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
    const bookId = argValue("book") ?? buckeyeInventoryIdentity().bookId;
    const cov = oddsLinkCoverage(db, bookId);
    if (json) {
      console.log(JSON.stringify({ oddsStatus: true, ...cov }, null, 2));
    } else {
      console.log(`inventory:sync --odds-status ${formatOddsLinkCoverage(cov)}`);
    }
    return;
  }

  if (loop && dryRun) {
    throw new Error("inventory:sync --dry-run cannot be combined with --loop");
  }

  const onceOpts = {
    dryRun,
    sport: argValue("sport") ?? "table_tennis",
    enrichBooked: hasFlag("enrich-booked"),
    enrichBookedScope: parseEnrichBookedScope(argValue("enrich-scope")),
    json,
  };

  if (!loop) {
    await runOnce(onceOpts);
    return;
  }

  console.log(`inventory:sync loop intervalMs=${intervalMs}`);
  for (;;) {
    try {
      await runOnce({ ...onceOpts, dryRun: false });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    await Bun.sleep(intervalMs);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
