#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
/**
 * One-shot match_liquidity operator pipeline.
 *
 *   bun run liquidity:pipeline
 *   bun run liquidity:pipeline -- --fetch-volume --snapshot
 *   bun run liquidity:pipeline -- --fetch-volume --limit=40 --no-ground
 *   bun --watch run liquidity:pipeline -- --no-ground   # dev: re-run on file change
 */
import { parseArgs } from "node:util";
import {
  MATCH_LIQUIDITY_PIPELINE_DEFAULT_VOLUME_LIMIT,
  formatMatchLiquidityPipelineLines,
  runMatchLiquidityPipeline,
} from "../src/institutions/event-store/match-liquidity-pipeline.ts";

export async function runMatchLiquidityPipelineCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      "fetch-volume": { type: "boolean", default: false },
      limit: { type: "string" },
      snapshot: { type: "boolean", default: false },
      "dry-run-snapshot": { type: "boolean", default: false },
      "no-ground": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  const limit = values.limit ? Number(values.limit) : MATCH_LIQUIDITY_PIPELINE_DEFAULT_VOLUME_LIMIT;
  const result = await runMatchLiquidityPipeline({
    ...(typeof values.db === "string" ? { dbPath: values.db } : {}),
    fetchVolume: values["fetch-volume"] === true,
    volumeLimit: Number.isFinite(limit) ? limit : MATCH_LIQUIDITY_PIPELINE_DEFAULT_VOLUME_LIMIT,
    groundHtml: values["no-ground"] !== true,
    snapshot: values.snapshot === true,
    dryRunSnapshot: values["dry-run-snapshot"] === true,
  });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatMatchLiquidityPipelineLines(result).join("\n"));
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await runMatchLiquidityPipelineCli(process.argv.slice(2)));
}
