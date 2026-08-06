#!/usr/bin/env bun
import { runKalshiLifecycleSyncJob } from "./partner-sync-kalshi-lifecycle.ts";

export default {
  async scheduled(): Promise<void> {
    const result = await runKalshiLifecycleSyncJob();
    if (
      result.failedAccounts > 0 ||
      result.orphanProviderOrders > 0 ||
      result.orphanConfirmedReservations > 0 ||
      result.accountsWithDrift > 0
    ) {
      throw new Error("scheduled Kalshi lifecycle sync found failures or unexplained orphans");
    }
  },
};
