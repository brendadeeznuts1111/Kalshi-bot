#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron#bun-cron-path-schedule-title-os-level
/**
 * Register / remove / preview the tennis factorial experiment daily check (OS Bun.cron).
 *
 * Default: daily at 09:00 local — runs dailyCheck on all active experiments.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { previewFireTimes } from "../../src/research/schedule-cli.ts";
import { TENNIS_EXPERIMENT_CRON_SCHEDULE } from "../../src/institutions/event-store/tennis-lane-constants.ts";

export { TENNIS_EXPERIMENT_CRON_SCHEDULE } from "../../src/institutions/event-store/tennis-lane-constants.ts";
export const TENNIS_EXPERIMENT_CRON_TITLE = "kalshi-tennis-experiment-daily";
export const TENNIS_EXPERIMENT_WORKER_PATH = join(import.meta.dir, "experiment-scheduled.ts");

export type TennisExperimentScheduleCommand = "register" | "remove" | "preview";

export function parseExperimentScheduleCli(argv: string[]): {
  command: TennisExperimentScheduleCommand;
  schedule: string;
  title: string;
  count: number;
} | null {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const command = positional[0] as TennisExperimentScheduleCommand | undefined;
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
        : Bun.env.TENNIS_EXPERIMENT_CRON_SCHEDULE?.trim() || TENNIS_EXPERIMENT_CRON_SCHEDULE,
    title:
      typeof values.title === "string"
        ? values.title
        : Bun.env.TENNIS_EXPERIMENT_CRON_TITLE?.trim() || TENNIS_EXPERIMENT_CRON_TITLE,
    count,
  };
}

if (import.meta.main) {
  const opts = parseExperimentScheduleCli(Bun.argv.slice(2));
  if (!opts) {
    console.error(
      "Usage: bun tools/tennis/experiment-schedule-cli.ts <register|remove|preview> [--schedule='0 9 * * *']",
    );
    process.exit(1);
  }

  switch (opts.command) {
    case "register": {
      await Bun.cron(TENNIS_EXPERIMENT_WORKER_PATH, opts.schedule, opts.title);
      console.log(`Registered OS cron job "${opts.title}"`);
      console.log(`  worker: ${TENNIS_EXPERIMENT_WORKER_PATH}`);
      console.log(`  schedule: ${opts.schedule} (system local time)`);
      console.log(`  manual: bun run tennis:experiment -- check-all`);
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
