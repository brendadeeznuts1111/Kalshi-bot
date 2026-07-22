#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron#bun-cron-path-schedule-title-os-level
/**
 * Register / remove / preview the tennis live dry-run canary (OS Bun.cron).
 *
 * Default: every 15 minutes — cheap schema-drift smoke while matches may be live.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { previewFireTimes } from "../../src/research/schedule-cli.ts";

/** Every 15m local — dense enough to catch API renames during a match day. */
export const TENNIS_LIVE_CANARY_CRON_SCHEDULE = "*/15 * * * *";
export const TENNIS_LIVE_CANARY_CRON_TITLE = "kalshi-tennis-live-canary";
export const TENNIS_LIVE_CANARY_WORKER_PATH = join(
  import.meta.dir,
  "live-canary-scheduled.ts",
);

export type TennisLiveCanaryScheduleCommand = "register" | "remove" | "preview";

export function parseTennisLiveCanaryScheduleCli(argv: string[]): {
  command: TennisLiveCanaryScheduleCommand;
  schedule: string;
  title: string;
  count: number;
} | null {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const command = positional[0] as TennisLiveCanaryScheduleCommand | undefined;
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
        : Bun.env.TENNIS_LIVE_CANARY_CRON_SCHEDULE?.trim() || TENNIS_LIVE_CANARY_CRON_SCHEDULE,
    title:
      typeof values.title === "string"
        ? values.title
        : Bun.env.TENNIS_LIVE_CANARY_CRON_TITLE?.trim() || TENNIS_LIVE_CANARY_CRON_TITLE,
    count,
  };
}

if (import.meta.main) {
  const opts = parseTennisLiveCanaryScheduleCli(Bun.argv.slice(2));
  if (!opts) {
    console.error(
      "Usage: bun tools/tennis/live-canary-schedule-cli.ts <register|remove|preview> [--schedule='*/15 * * * *']",
    );
    process.exit(1);
  }

  switch (opts.command) {
    case "register": {
      await Bun.cron(TENNIS_LIVE_CANARY_WORKER_PATH, opts.schedule, opts.title);
      console.log(`Registered OS cron job "${opts.title}"`);
      console.log(`  worker: ${TENNIS_LIVE_CANARY_WORKER_PATH}`);
      console.log(`  schedule: ${opts.schedule} (system local time)`);
      console.log(`  logs (macOS): /tmp/bun.cron.${opts.title}.stdout.log`);
      console.log(`  manual: bun run tennis:live -- --canary`);
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
      break;
    }
  }
}
