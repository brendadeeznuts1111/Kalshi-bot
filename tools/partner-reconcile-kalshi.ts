#!/usr/bin/env bun
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { createKalshiAccountClientResolver } from "../src/partner/execution/kalshi-live.ts";
import { reconcileKalshiUnknownReservations } from "../src/partner/execution/reconciliation.ts";
import { migrateExecutionSchema } from "../src/partner/execution/sql.ts";
import { getBettingAccountById } from "../src/partner/registry.ts";

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8);
const limit = limitArg === undefined ? 100 : Number(limitArg);

const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
try {
  migrateExecutionSchema(db);
  const resolveAccountClient = createKalshiAccountClientResolver();
  const result = await reconcileKalshiUnknownReservations(db, {
    limit,
    resolveClient: (reservation) => {
      const account = getBettingAccountById(db, reservation.outId);
      if (account === null) throw new Error(`Execution out ${reservation.outId} no longer exists`);
      if (account.provider.toLowerCase() !== "kalshi") {
        throw new Error(`Execution out ${reservation.outId} is no longer a Kalshi account`);
      }
      return resolveAccountClient(account);
    },
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors > 0 || result.conflicts > 0) process.exitCode = 2;
} finally {
  db.close();
}
