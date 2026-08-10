#!/usr/bin/env bun
/**
 * Unified partner inventory sync (Fantasy402 blueprint — ground truth).
 *
 * Discovers new stream events → skin_events.
 * Optional --enrich-booked: soft-match Statscore names → client_event_id (not odds).
 *
 * Usage:
 *   bun run partner:sync -- --sport=table_tennis --once
 *   bun run partner:sync -- --sport=table_tennis --loop --interval-ms=30000
 *   bun run partner:sync -- --enrich-booked --json
 */
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  getFantasySessionAdapter,
  requireFantasy402ProfileFromEnv,
} from "../src/partner/index.ts";
import {
  formatSyncReport,
  runPartnerInventorySync,
} from "../src/partner/sync.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function runOnce(): Promise<void> {
  const sport = argValue("sport") ?? "table_tennis";
  const enrichBooked = hasFlag("enrich-booked");
  const json = hasFlag("json");

  const profile = requireFantasy402ProfileFromEnv();
  const adapter = getFantasySessionAdapter(profile, { warmSession: false });
  // Optional login — inventory works without it
  try {
    await adapter.login();
  } catch {
    /* continue */
  }

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  const report = await runPartnerInventorySync(db, adapter, {
    sport,
    enrichBooked,
  });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatSyncReport(report));
  }
}

async function main(): Promise<void> {
  const loop = hasFlag("loop");
  const intervalMs = Math.max(
    Number(argValue("interval-ms") ?? "30000") || 30_000,
    5_000,
  );

  if (!loop) {
    await runOnce();
    return;
  }

  console.log(`partner:sync loop intervalMs=${intervalMs}`);
  for (;;) {
    try {
      await runOnce();
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
