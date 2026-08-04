// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
/**
 * OS-level cron worker — match_liquidity operator loop.
 *
 * Register: bun run liquidity:pipeline:register
 * Manual:   bun run liquidity:pipeline -- --fetch-volume --snapshot
 *
 * Env:
 *   LIQUIDITY_PIPELINE_SKIP_NETWORK=1  — recompute + ground only (no Kalshi GET)
 *   LIQUIDITY_PIPELINE_VOLUME_LIMIT    — backfill limit (default 80)
 *   LIQUIDITY_PIPELINE_SNAPSHOT=0      — skip registry snapshot write
 */
import {
  MATCH_LIQUIDITY_PIPELINE_DEFAULT_VOLUME_LIMIT,
  formatMatchLiquidityPipelineLines,
  runMatchLiquidityPipeline,
} from "../src/institutions/event-store/match-liquidity-pipeline.ts";

process.on("unhandledRejection", (err) => {
  console.error("[match-liquidity-pipeline] unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[match-liquidity-pipeline] uncaught exception:", err);
});

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    console.error(`[match-liquidity-pipeline] fire ${controller.cron} @ ${when}`);

    const skipNetwork = Bun.env.LIQUIDITY_PIPELINE_SKIP_NETWORK === "1";
    const volumeLimit = Number(Bun.env.LIQUIDITY_PIPELINE_VOLUME_LIMIT ?? "");
    const snapshot = Bun.env.LIQUIDITY_PIPELINE_SNAPSHOT !== "0";

    try {
      const result = await runMatchLiquidityPipeline({
        fetchVolume: !skipNetwork,
        volumeLimit: Number.isFinite(volumeLimit) && volumeLimit > 0
          ? volumeLimit
          : MATCH_LIQUIDITY_PIPELINE_DEFAULT_VOLUME_LIMIT,
        groundHtml: true,
        snapshot,
        dryRunSnapshot: false,
      });
      console.error(formatMatchLiquidityPipelineLines(result).join("\n"));
    } catch (err) {
      console.error(`[match-liquidity-pipeline] failed:`, err);
      throw err;
    }
  },
};
