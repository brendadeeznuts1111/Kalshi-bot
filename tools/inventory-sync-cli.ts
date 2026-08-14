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
 *   bun run inventory:sync -- --sport=table_tennis,tennis --once
 *   bun run inventory:sync -- --sport="table_tennis, tennis" --once   # spaces OK
 *   bun run inventory:sync -- --enrich-booked --json
 *   bun run inventory:sync -- --enrich-booked --enrich-scope=board
 *   bun run inventory:sync -- --enrich-booked --enrich-scope=unlinked
 *   bun run inventory:sync -- --odds-status
 *   bun run inventory:sync -- --enrich-only --enrich-scope=unlinked
 *   bun run inventory:sync -- --enrich-only --dry-run
 *   bun run inventory:enrich:quality   # dry-run JSON + match-rate report
 *   bun run inventory:sync -- --enrich-only --min-match-rate=0.1 --fail-on-enrich-quality
 *
 * --sport: single, CSV multi (spaces trimmed), or all. Multi fetches full board then filters.
 * Default sport filter when omitted: table_tennis (CLI). Cron defaults to all.
 * --dry-run: fetch + plan insert/update only (no SQLite writes; enrich is planned only).
 *            Incompatible with --loop.
 * --enrich-scope: new | board (default) | unlinked
 * --enrich-only: skip stream poll; public Statscore catalog → odds_event_id
 * --odds-status: odds_event_id fill-rate only (no poll)
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
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
import type { PartnerAccountProfile } from "../src/partner/account-profile.ts";
import { publicFantasyProfile } from "../src/inventory/public-profile.ts";

function resolveProfile(allowPublic: boolean): PartnerAccountProfile {
  const fromEnv = loadFantasy402ProfileFromEnv();
  if (fromEnv) return fromEnv;
  if (
    allowPublic ||
    Bun.env.INVENTORY_SYNC_PUBLIC === "1" ||
    Bun.env.PARTNER_SYNC_PUBLIC === "1"
  ) {
    return publicFantasyProfile();
  }
  return requireFantasy402ProfileFromEnv();
}

async function runOnce(options: {
  dryRun: boolean;
  sport: string;
  enrichBooked: boolean;
  enrichOnly: boolean;
  enrichBookedScope: ReturnType<typeof parseEnrichBookedScope>;
  enrichCatalogMax?: number;
  minMatchRate?: number | null;
  minLinkedPct?: number | null;
  failOnEnrichQuality?: boolean;
  json: boolean;
}): Promise<void> {
  // enrich-only / dry-run can use public dummy profile
  const profile = resolveProfile(options.dryRun || options.enrichOnly);
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
    enrichBooked: options.enrichBooked || options.enrichOnly,
    enrichOnly: options.enrichOnly,
    enrichBookedScope: options.enrichBookedScope,
    enrichCatalogMax: options.enrichCatalogMax,
    dryRun: options.dryRun,
    minMatchRate: options.minMatchRate,
    minLinkedPct: options.minLinkedPct,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatSyncReport(report));
  }

  if (
    options.failOnEnrichQuality &&
    report.enrichQuality &&
    !report.enrichQuality.passed
  ) {
    process.exitCode = 1;
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

  const enrichOnly = hasFlag("enrich-only");
  const catalogMaxRaw = argValue("enrich-catalog-max");
  const minMatchRateRaw = argValue("min-match-rate");
  const minLinkedPctRaw = argValue("min-linked-pct");
  const onceOpts = {
    dryRun,
    sport: argValue("sport") ?? (enrichOnly ? "all" : "table_tennis"),
    enrichBooked: hasFlag("enrich-booked"),
    enrichOnly,
    enrichBookedScope: parseEnrichBookedScope(
      argValue("enrich-scope") ?? (enrichOnly ? "unlinked" : undefined),
    ),
    enrichCatalogMax: catalogMaxRaw
      ? Number(catalogMaxRaw) || undefined
      : undefined,
    minMatchRate:
      minMatchRateRaw != null && minMatchRateRaw !== ""
        ? Number(minMatchRateRaw)
        : null,
    minLinkedPct:
      minLinkedPctRaw != null && minLinkedPctRaw !== ""
        ? Number(minLinkedPctRaw)
        : null,
    failOnEnrichQuality: hasFlag("fail-on-enrich-quality"),
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
