// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
/**
 * OS-level cron worker — daily factorial experiment check for all active experiments.
 *
 * Register: bun run tennis:experiment:register
 * Manual:   bun run tennis:experiment -- check-all
 */
import { ExperimentRunner } from "../../src/operations/experiment-runner.ts";

process.on("unhandledRejection", (err) => {
  console.error("[tennis-experiment] unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[tennis-experiment] uncaught exception:", err);
});

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    console.error(`[tennis-experiment] fire ${controller.cron} @ ${when}`);

    const runner = ExperimentRunner.open();
    const results = await runner.dailyCheckAll();
    if (results.length === 0) {
      console.error("[tennis-experiment] no active experiments");
      return;
    }
    for (const { experimentId, result } of results) {
      console.error(
        `[tennis-experiment] ${experimentId} status=${result.status} days=${result.daysRunning.toFixed(1)}` +
          (result.reason ? ` reason=${result.reason}` : ""),
      );
      if (result.status === "early_stop" || result.status === "completed") {
        continue;
      }
    }
  },
};
