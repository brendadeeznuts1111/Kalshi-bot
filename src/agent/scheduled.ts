// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
// @see https://bun.com/docs/runtime/environment-variables
/**
 * OS-level cron worker for the managed agent CLI (§203). Delegates to the
 * OFFLINE agent pipeline: discovery ground over cache.db + agent report write
 * (research/reports/agent-report.md + .json). No live GitHub, no execution.
 *
 * Register: bun run agent:schedule:register
 * Manual:   bun run agent ground && bun run agent report
 */
import { runDiscoveryGround } from './discovery-ground.ts';
import { runAgentReportCmd } from './cli.ts';

process.on('unhandledRejection', (err) => {
  console.error('[kalshi-agent] unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('[kalshi-agent] uncaught exception:', err);
});

export type ScheduledAgentDeps = {
  runGround?: (options?: { dimension?: string }) => Promise<unknown>;
  runReport?: (json: boolean, dimension?: string, runId?: string, noWrite?: boolean) => Promise<number>;
};

/** Run the offline agent pipeline once; returns the two exit codes. */
export async function runScheduledAgent(deps: ScheduledAgentDeps = {}): Promise<{ groundExit: number; reportExit: number }> {
  const groundFn = deps.runGround ?? runDiscoveryGround;
  const reportFn = deps.runReport ?? runAgentReportCmd;
  await groundFn({});
  const reportExit = await reportFn(false);
  return { groundExit: 0, reportExit };
}

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    console.error('[kalshi-agent] fire ' + controller.cron + ' @ ' + when);

    const { groundExit, reportExit } = await runScheduledAgent();
    console.error('[kalshi-agent] complete ground=' + groundExit + ' report=' + reportExit);

    if (groundExit !== 0 || reportExit !== 0) {
      throw new Error('kalshi-agent pipeline failed ground=' + groundExit + ' report=' + reportExit);
    }
  },
};
