#!/usr/bin/env bun
import { runKalshiReconciliationJob } from "./partner-reconcile-kalshi.ts";

export default {
  async scheduled(): Promise<void> {
    const result = await runKalshiReconciliationJob();
    if (result.reconciliation.errors > 0 || result.reconciliation.conflicts > 0) {
      throw new Error("scheduled Kalshi reconciliation completed with errors or conflicts");
    }
  },
};
