// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
/**
 * OS-level cron worker — tennis watch-set orderbook WebSocket recorder.
 * Persists session artifacts via tennis-ws-recorder-store (inside recorder path).
 *
 * Register: bun run tennis:record:ws:register
 * Manual:   bun run tennis:record -- --ws --ws-seconds=300
 */
import { runTennisRecordCli } from "./record-cli.ts";
import { resolveWsRecorderWsSeconds } from "./ws-recorder-schedule-cli.ts";

process.on("unhandledRejection", (err) => {
  console.error("[tennis-ws-recorder] unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[tennis-ws-recorder] uncaught exception:", err);
});

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    const wsSeconds = resolveWsRecorderWsSeconds();
    console.error(
      `[tennis-ws-recorder] fire ${controller.cron} @ ${when} ws-seconds=${wsSeconds}`,
    );

    const code = await runTennisRecordCli(["--ws", `--ws-seconds=${wsSeconds}`]);
    if (code !== 0) {
      console.error(`[tennis-ws-recorder] exit ${code}`);
      // Re-throw so Bun.cron records a failed fire in OS logs.
      throw new Error(`tennis ws recorder failed with exit ${code}`);
    }
  },
};
