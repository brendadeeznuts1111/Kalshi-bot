#!/usr/bin/env bun
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { createKalshiAccountClientResolver } from "../src/partner/execution/kalshi-live.ts";
import { syncKalshiProviderLifecycle } from "../src/partner/execution/kalshi-lifecycle-sync.ts";
import { migrateExecutionSchema } from "../src/partner/execution/sql.ts";

export async function runKalshiLifecycleSyncJob(options: {
  maxPagesPerFeed?: number | undefined;
  pageSize?: number | undefined;
} = {}) {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  try {
    migrateExecutionSchema(db);
    return await syncKalshiProviderLifecycle(db, {
      resolveClient: createKalshiAccountClientResolver(),
      ...(options.maxPagesPerFeed !== undefined ? { maxPagesPerFeed: options.maxPagesPerFeed } : {}),
      ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
    });
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const maxPagesPerFeed = integerArg("max-pages");
  const pageSize = integerArg("page-size");
  const result = await runKalshiLifecycleSyncJob({ maxPagesPerFeed, pageSize });
  console.log(JSON.stringify(result, null, 2));
  if (
    result.failedAccounts > 0 ||
    result.orphanProviderOrders > 0 ||
    result.orphanConfirmedReservations > 0 ||
    result.accountsWithDrift > 0
  ) process.exitCode = 2;
}

function integerArg(name: string): number | undefined {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`--${name} must be a positive integer`);
  return value;
}
