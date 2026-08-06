#!/usr/bin/env bun
import { runReceiptDeliveryJob } from "./partner-deliver-receipts.ts";

export default {
  async scheduled(): Promise<void> {
    const result = await runReceiptDeliveryJob();
    if (result.failed > 0 || result.dead > 0) {
      throw new Error("scheduled receipt delivery completed with failed or dead receipts");
    }
  },
};
