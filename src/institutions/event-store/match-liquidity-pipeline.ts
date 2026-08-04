// @see https://bun.com/docs/runtime/cron
// @see https://bun.com/docs/runtime/sqlite
/**
 * End-to-end match_liquidity operator loop (recompute → optional volume backfill
 * → optional HTML ground → optional data-plane snapshot).
 *
 * Used by:
 *   - in-process Bun.cron (scripts/cron-main.ts)
 *   - OS Bun.cron worker (tools/match-liquidity-scheduled.ts)
 *   - CLI one-shot (tools/match-liquidity-pipeline-cli.ts)
 */
import type { Database } from "bun:sqlite";
import { ensureEventStoreDir, openEventStore } from "./open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "./paths.ts";
import {
  recomputeMatchLiquidity,
  summarizeMatchLiquidity,
  type MatchLiquiditySummary,
} from "./match-liquidity.ts";
import {
  backfillQuotedMarketVolumes,
  type BackfillVolumeResult,
} from "./match-liquidity-backfill.ts";
import {
  captureMatchLiquidityGround,
  persistMatchLiquidityGroundArtifact,
} from "./match-liquidity-ground.ts";

/** Default in-process / OS schedule (UTC for in-process; local for OS register). */
export const MATCH_LIQUIDITY_PIPELINE_CRON_SCHEDULE = "*/30 * * * *";
export const MATCH_LIQUIDITY_PIPELINE_CRON_TITLE = "kalshi-match-liquidity-pipeline";
export const MATCH_LIQUIDITY_PIPELINE_DEFAULT_VOLUME_LIMIT = 80;

export type MatchLiquidityPipelineOptions = {
  dbPath?: string;
  /** When true, call Kalshi public market GET for quoted zero-vol tickers. */
  fetchVolume?: boolean;
  volumeLimit?: number;
  /** Write research/cache/match-liquidity-ground HTML (no WebView). */
  groundHtml?: boolean;
  /** Persist data-plane snapshot to research/registry. */
  snapshot?: boolean;
  dryRunSnapshot?: boolean;
  /** Injected db for tests. */
  db?: Database;
};

export type MatchLiquidityPipelineResult = {
  at: string;
  recomputeRows: number;
  summary: MatchLiquiditySummary;
  backfill: BackfillVolumeResult | null;
  groundHtml: string | null;
  snapshotRun: string | null;
};

export async function runMatchLiquidityPipeline(
  options: MatchLiquidityPipelineOptions = {},
): Promise<MatchLiquidityPipelineResult> {
  await ensureEventStoreDir();
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const db = options.db ?? openEventStore({ dbPath });

  const recomputeRows = recomputeMatchLiquidity(db);

  let backfill: BackfillVolumeResult | null = null;
  if (options.fetchVolume) {
    backfill = await backfillQuotedMarketVolumes(db, {
      limit: options.volumeLimit ?? MATCH_LIQUIDITY_PIPELINE_DEFAULT_VOLUME_LIMIT,
    });
  }

  let groundHtml: string | null = null;
  if (options.groundHtml !== false) {
    // default true for cron operator loop
    const artifact = await captureMatchLiquidityGround(db, { htmlOnly: true });
    await persistMatchLiquidityGroundArtifact(artifact);
    groundHtml = artifact.dashboardHtml;
  }

  let snapshotRun: string | null = null;
  if (options.snapshot) {
    const { captureSnapshot } = await import("../../../tools/snapshot-data-plane.ts");
    const snap = await captureSnapshot({
      dbPath,
      dryRun: options.dryRunSnapshot === true,
    });
    snapshotRun = snap.run;
  }

  const summary = summarizeMatchLiquidity(db);
  return {
    at: new Date().toISOString(),
    recomputeRows,
    summary,
    backfill,
    groundHtml,
    snapshotRun,
  };
}

export function formatMatchLiquidityPipelineLines(result: MatchLiquidityPipelineResult): string[] {
  const s = result.summary;
  const lines = [
    "Match liquidity pipeline",
    `  at=${result.at}`,
    `  recompute=${result.recomputeRows}`,
    `  rows=${s.total} quoted=${s.quoted} liq_ok=${s.liquidityOk} tradable=${s.tradable}`,
  ];
  if (result.backfill) {
    const b = result.backfill;
    lines.push(
      `  backfill: candidates=${b.candidates} updated=${b.updated} errors=${b.errors}`,
    );
  }
  if (result.groundHtml) lines.push(`  ground=${result.groundHtml}`);
  if (result.snapshotRun) lines.push(`  snapshot=${result.snapshotRun}`);
  return lines;
}
