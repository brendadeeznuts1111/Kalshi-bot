// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
/**
 * OS-level cron worker — tennis live_data dry-run canary (schema / API drift).
 * Full read path to the write boundary; zero live_scores / score_snapshots writes.
 *
 * Register: bun run tennis:live:canary:register
 * Manual:   bun run tennis:live -- --canary
 */
import { runLiveScoresCli } from "./live-scores-cli.ts";

process.on("unhandledRejection", (err) => {
  console.error("[tennis-live-canary] unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[tennis-live-canary] uncaught exception:", err);
});

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    console.error(`[tennis-live-canary] fire ${controller.cron} @ ${when}`);

    const code = await runLiveScoresCli(["--canary"]);
    if (code !== 0) {
      console.error(`[tennis-live-canary] exit ${code}`);
      // Re-throw so Bun.cron records a failed fire in OS logs.
      throw new Error(`tennis live canary failed with exit ${code}`);
    }
  },
};
