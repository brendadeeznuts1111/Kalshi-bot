// @see https://bun.com/docs/runtime/cron#bun-cron-path-schedule-title-os-level
// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
/**
 * OS-level cron worker — export default { scheduled } for Bun.cron(path, schedule, title).
 * Delegates to runResearch(); no pipeline logic here.
 */
import { runResearch } from "./cli.ts";

process.on("unhandledRejection", (err) => {
  console.error("[kalshi-research] unhandled rejection:", err);
});

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    console.error(`[kalshi-research] fire ${controller.cron} @ ${when}`);

    const run = await runResearch({
      json: false,
      exportAudit: Bun.env.RESEARCH_EXPORT_AUDIT === "1",
    });

    console.error(`[kalshi-research] complete run=${run.runId} shortlist=${run.shortlist.length}`);
  },
};
