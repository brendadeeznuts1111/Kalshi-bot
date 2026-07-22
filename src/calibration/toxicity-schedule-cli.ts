#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron#bun-cron-path-schedule-title-os-level
import { join } from "node:path";
import { parseArgs } from "node:util";
import { previewFireTimes } from "../research/schedule-cli.ts";

export const TOXICITY_CRON_SCHEDULE = "*/1 * * * *";
export const TOXICITY_CRON_TITLE = "kalshi-toxicity-mark";
export const TOXICITY_SCHEDULED_WORKER_PATH = join(import.meta.dir, "toxicity-scheduled.ts");

export type ToxicityScheduleCommand = "register" | "remove" | "preview";

export function parseToxicityScheduleCli(argv: string[]): {
  command: ToxicityScheduleCommand;
  schedule: string;
  title: string;
  count: number;
} | null {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const command = positional[0] as ToxicityScheduleCommand | undefined;
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
        : Bun.env.TOXICITY_CRON_SCHEDULE?.trim() || TOXICITY_CRON_SCHEDULE,
    title:
      typeof values.title === "string"
        ? values.title
        : Bun.env.TOXICITY_CRON_TITLE?.trim() || TOXICITY_CRON_TITLE,
    count,
  };
}

if (import.meta.main) {
  const opts = parseToxicityScheduleCli(Bun.argv.slice(2));
  if (!opts) {
    console.error(
      "Usage: bun src/calibration/toxicity-schedule-cli.ts <register|remove|preview> [--schedule='*/1 * * * *']",
    );
    process.exit(1);
  }

  switch (opts.command) {
    case "register": {
      await Bun.cron(TOXICITY_SCHEDULED_WORKER_PATH, opts.schedule, opts.title);
      console.log(`Registered OS cron job "${opts.title}"`);
      console.log(`  worker: ${TOXICITY_SCHEDULED_WORKER_PATH}`);
      console.log(`  schedule: ${opts.schedule} (system local time)`);
      console.log(`  Prefer in-process loop while shadow-running: bun run calibration:toxicity:loop`);
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
