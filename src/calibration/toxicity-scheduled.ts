// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
/**
 * OS-level cron worker — sweeps alpha programs for toxicity marks in the T+60s window.
 * Register: bun run calibration:toxicity:register
 */
import { runToxicitySweep } from "./shadow-maintenance.ts";

process.on("unhandledRejection", (err) => {
  console.error("[kalshi-toxicity] unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[kalshi-toxicity] uncaught exception:", err);
});

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    console.error(`[kalshi-toxicity] fire ${controller.cron} @ ${when}`);

    const results = await runToxicitySweep();
    for (const row of results) {
      console.error(
        `[kalshi-toxicity] ${row.program}: marked=${row.marked} pending=${row.pending} missed=${row.missed}`,
      );
    }
  },
};
