// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
// @see https://bun.com/docs/runtime/environment-variables
/**
 * OS-level cron worker — export default { scheduled } for Bun.cron(path, schedule, title).
 * Delegates to runResearch(); no pipeline logic here.
 */
import { normalizeDimensionId } from "./dimensions.ts";
import { runResearch, type CliOptions } from "./cli.ts";
import type { ResearchRun } from "./types.ts";

process.on("unhandledRejection", (err) => {
  console.error("[kalshi-research] unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[kalshi-research] uncaught exception:", err);
});

export type ScheduledDeps = {
  runResearch?: (opts: CliOptions) => Promise<ResearchRun>;
};

export async function runScheduledResearch(deps: ScheduledDeps = {}): Promise<ResearchRun> {
  const runFn = deps.runResearch ?? runResearch;
  return runFn({
    json: false,
    exportAudit: Bun.env.RESEARCH_EXPORT_AUDIT === "1",
    dryRun: false,
    dimension: normalizeDimensionId(Bun.env.RESEARCH_DIMENSION),
  });
}

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    console.error(`[kalshi-research] fire ${controller.cron} @ ${when}`);

    const run = await runScheduledResearch();

    console.error(`[kalshi-research] complete run=${run.runId} shortlist=${run.shortlist.length}`);
  },
};
