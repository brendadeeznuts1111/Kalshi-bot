#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron#bun-cron-path-schedule-title-os-level
// @see https://bun.com/docs/runtime/cron#bun-cron-remove
// @see https://bun.com/docs/runtime/cron#bun-cron-parse
/**
 * Register / remove / preview the match_liquidity OS Bun.cron job.
 *
 *   bun run liquidity:pipeline:register
 *   bun run liquidity:pipeline:preview
 *   bun run liquidity:pipeline:remove
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { previewFireTimes } from "../src/research/schedule-cli.ts";
import {
  MATCH_LIQUIDITY_PIPELINE_CRON_SCHEDULE,
  MATCH_LIQUIDITY_PIPELINE_CRON_TITLE,
} from "../src/institutions/event-store/match-liquidity-pipeline.ts";

export { MATCH_LIQUIDITY_PIPELINE_CRON_SCHEDULE, MATCH_LIQUIDITY_PIPELINE_CRON_TITLE };
export const MATCH_LIQUIDITY_PIPELINE_WORKER_PATH = join(
  import.meta.dir,
  "match-liquidity-scheduled.ts",
);

export type LiquidityScheduleCommand = "register" | "remove" | "preview";

export function parseLiquidityScheduleCli(argv: string[]): {
  command: LiquidityScheduleCommand;
  schedule: string;
  title: string;
  count: number;
} | null {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const command = positional[0] as LiquidityScheduleCommand | undefined;
  if (!command || !["register", "remove", "preview"].includes(command)) {
    return null;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      schedule: { type: "string" },
      title: { type: "string" },
      count: { type: "string", default: "3" },
    },
    strict: false,
  });

  const countRaw = values.count ? Number(values.count) : 3;
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 3;

  return {
    command,
    schedule:
      typeof values.schedule === "string"
        ? values.schedule
        : Bun.env.LIQUIDITY_PIPELINE_CRON_SCHEDULE?.trim() ||
          MATCH_LIQUIDITY_PIPELINE_CRON_SCHEDULE,
    title:
      typeof values.title === "string"
        ? values.title
        : Bun.env.LIQUIDITY_PIPELINE_CRON_TITLE?.trim() || MATCH_LIQUIDITY_PIPELINE_CRON_TITLE,
    count,
  };
}

if (import.meta.main) {
  const opts = parseLiquidityScheduleCli(Bun.argv.slice(2));
  if (!opts) {
    console.error(
      "Usage: bun tools/match-liquidity-schedule-cli.ts <register|remove|preview> [--schedule='*/30 * * * *']",
    );
    process.exit(1);
  }

  switch (opts.command) {
    case "register": {
      await Bun.cron(MATCH_LIQUIDITY_PIPELINE_WORKER_PATH, opts.schedule, opts.title);
      console.log(`Registered OS cron job "${opts.title}"`);
      console.log(`  worker: ${MATCH_LIQUIDITY_PIPELINE_WORKER_PATH}`);
      console.log(`  schedule: ${opts.schedule} (system local time)`);
      console.log(`  logs (macOS): /tmp/bun.cron.${opts.title}.stdout.log`);
      console.log(`  manual: bun run liquidity:pipeline -- --fetch-volume --snapshot`);
      console.log(`  skip network: LIQUIDITY_PIPELINE_SKIP_NETWORK=1`);
      break;
    }
    case "remove": {
      await Bun.cron.remove(opts.title);
      console.log(`Removed OS cron job "${opts.title}" (if present)`);
      break;
    }
    case "preview": {
      const times = previewFireTimes(opts.schedule, opts.count);
      if (!times.length) {
        console.error(`No upcoming fires for: ${opts.schedule}`);
        process.exit(1);
      }
      console.log(`Schedule: ${opts.schedule}`);
      console.log(`Title: ${opts.title}`);
      console.log(`Next ${times.length} fire(s) (UTC, Bun.cron.parse):`);
      for (const [i, d] of times.entries()) {
        console.log(`  ${i + 1}. ${d.toISOString()}`);
      }
      console.log("Note: OS-level register uses system local time — preview is UTC.");
      break;
    }
  }
}
