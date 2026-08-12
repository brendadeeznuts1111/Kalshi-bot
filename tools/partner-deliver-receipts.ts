#!/usr/bin/env bun
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { migrateExecutionSchema } from "../src/partner/execution/sql.ts";
import { asAuthorizationReceiptLeaseOwner } from "../src/partner/authorization/outbox.ts";
import { deliverAuthorizationReceiptBatch } from "../src/telegram/authorization-outbox-worker.ts";
import { sendMessage } from "../src/telegram/api.ts";
import { mintSortableId } from "../src/lib/ids.ts";

export async function runReceiptDeliveryJob(options: { limit?: number; nowMs?: number } = {}) {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new TypeError("receipt limit must be an integer from 1 to 1000");
  }
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  try {
    migrateExecutionSchema(db);
    return await deliverAuthorizationReceiptBatch(db, {
    nowMs: options.nowMs ?? Date.now(),
    leaseOwner: asAuthorizationReceiptLeaseOwner(`receipt-worker-${process.pid}-${mintSortableId()}`),
    limit,
    send: sendMessage,
    });
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const rawLimit = Bun.argv.find(arg => arg.startsWith("--limit="))?.slice(8);
  const result = await runReceiptDeliveryJob({ limit: rawLimit === undefined ? 100 : Number(rawLimit) });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0 || result.dead > 0) process.exitCode = 2;
}
