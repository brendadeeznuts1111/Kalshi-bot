#!/usr/bin/env bun
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { createKalshiAccountClientResolver } from "../src/partner/execution/kalshi-live.ts";
import { reconcileKalshiUnknownReservations } from "../src/partner/execution/reconciliation.ts";
import { migrateExecutionSchema } from "../src/partner/execution/sql.ts";
import { getBettingAccountById } from "../src/partner/registry.ts";
import { asReconciliationOwner } from "../src/partner/execution/domain.ts";
import { Database } from "bun:sqlite";
import { syncRegulatoryExecutionPlays } from "../src/regulatory/lib/execution-play-sync.ts";
import { runExecutionMaintenance } from "../src/partner/execution/maintenance.ts";

export async function runKalshiReconciliationJob(options: {
  limit?: number;
  regulatoryPath?: string;
} = {}) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new TypeError("reconciliation limit must be an integer from 1 to 1000");
  }
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  try {
    migrateExecutionSchema(db);
    // Recovery must not depend on the Telegram long-polling process. Move old
    // placing rows to exposure-bearing unknown before this worker claims due
    // reconciliation work; maintenance never infers provider rejection.
    const maintenance = runExecutionMaintenance(db, Date.now(), { provider: "kalshi" });
    const resolveAccountClient = createKalshiAccountClientResolver();
    const result = await reconcileKalshiUnknownReservations(db, {
    limit,
    owner: asReconciliationOwner(`kalshi-reconciler-${process.pid}-${crypto.randomUUID()}`),
    resolveClient: (reservation) => {
      const account = getBettingAccountById(db, reservation.outId);
      if (account === null) throw new Error(`Execution out ${reservation.outId} no longer exists`);
      if (account.provider.toLowerCase() !== "kalshi") {
        throw new Error(`Execution out ${reservation.outId} is no longer a Kalshi account`);
      }
      return resolveAccountClient(account);
    },
    });
    const regulatoryPath = options.regulatoryPath ?? Bun.env.REGULATORY_DB?.trim();
    let regulatory = null;
    if (regulatoryPath && regulatoryPath !== ":memory:") {
      const regulatoryDb = new Database(regulatoryPath);
      try {
        regulatory = syncRegulatoryExecutionPlays(regulatoryDb, db, limit);
      } finally {
        regulatoryDb.close();
      }
    }
    return { maintenance, reconciliation: result, regulatory };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8);
  const result = await runKalshiReconciliationJob({
    limit: limitArg === undefined ? 100 : Number(limitArg),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.reconciliation.errors > 0 || result.reconciliation.conflicts > 0) {
    process.exitCode = 2;
  }
}
