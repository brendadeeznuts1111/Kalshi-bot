#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron#bun-cron-path-schedule-title-os-level
// @see https://bun.com/docs/runtime/cron#bun-cron-remove
// @see https://bun.com/docs/runtime/cron#bun-cron-parse
// @see https://bun.com/docs/guides/process/argv
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RESEARCH_CRON_SCHEDULE, RESEARCH_CRON_TITLE } from "./constants.ts";

export const SCHEDULED_WORKER_PATH = join(import.meta.dir, "scheduled.ts");

export type ScheduleCommand = "register" | "remove" | "preview";

export type ScheduleCliOptions = {
  command: ScheduleCommand;
  schedule: string;
  title: string;
  count: number;
};

export function resolveSchedule(): string {
  return Bun.env.RESEARCH_CRON_SCHEDULE?.trim() || RESEARCH_CRON_SCHEDULE;
}

export function resolveTitle(): string {
  return Bun.env.RESEARCH_CRON_TITLE?.trim() || RESEARCH_CRON_TITLE;
}

export function parseScheduleCli(argv: string[]): ScheduleCliOptions | null {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const command = positional[0] as ScheduleCommand | undefined;
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
    schedule: typeof values.schedule === "string" ? values.schedule : resolveSchedule(),
    title: typeof values.title === "string" ? values.title : resolveTitle(),
    count,
  };
}

/** Next N fire times (UTC — Bun.cron.parse semantics). */
export function previewFireTimes(expression: string, count: number, from?: Date | number): Date[] {
  const out: Date[] = [];
  let cursor: Date | number = from ?? Date.now();
  for (let i = 0; i < count; i++) {
    const next = Bun.cron.parse(expression, cursor);
    if (!next) break;
    out.push(next);
    cursor = next.getTime() + 1;
  }
  return out;
}

export async function runScheduleCli(opts: ScheduleCliOptions): Promise<number> {
  switch (opts.command) {
    case "register": {
      await Bun.cron(SCHEDULED_WORKER_PATH, opts.schedule, opts.title);
      console.log(`Registered OS cron job "${opts.title}"`);
      console.log(`  worker: ${SCHEDULED_WORKER_PATH}`);
      console.log(`  schedule: ${opts.schedule} (system local time)`);
      console.log(`  logs (macOS): /tmp/bun.cron.${opts.title}.stdout.log`);
      return 0;
    }
    case "remove": {
      await Bun.cron.remove(opts.title);
      console.log(`Removed OS cron job "${opts.title}" (if present)`);
      return 0;
    }
    case "preview": {
      const times = previewFireTimes(opts.schedule, opts.count);
      if (!times.length) {
        console.error(`No upcoming fires for: ${opts.schedule}`);
        return 1;
      }
      console.log(`Schedule: ${opts.schedule}`);
      console.log(`Title: ${opts.title}`);
      console.log(`Next ${times.length} fire(s) (UTC, Bun.cron.parse):`);
      for (const [i, d] of times.entries()) {
        console.log(`  ${i + 1}. ${d.toISOString()}`);
      }
      console.log("Note: OS-level register uses system local time — preview is UTC.");
      return 0;
    }
    default:
      return 1;
  }
}

function printUsage(): void {
  console.error(`Usage: bun src/research/schedule-cli.ts <command> [options]

Commands:
  register   Register OS-level cron (launchd / crontab / Task Scheduler)
  remove     Remove registered job by title
  preview    Show next fire times (UTC parse preview)

Options:
  --schedule <expr>   Cron expression (default: ${RESEARCH_CRON_SCHEDULE})
  --title <id>        Job title (default: ${RESEARCH_CRON_TITLE})
  --count <n>         Preview count (default: 3)

Env:
  RESEARCH_CRON_SCHEDULE   Override default schedule
  RESEARCH_CRON_TITLE      Override default title
  RESEARCH_EXPORT_AUDIT=1  Export audit on scheduled runs

Examples:
  bun run schedule:preview
  bun run schedule:register
  bun run schedule:remove
`);
}

if (import.meta.main) {
  const opts = parseScheduleCli(Bun.argv.slice(2));
  if (!opts) {
    printUsage();
    process.exit(1);
  }
  const code = await runScheduleCli(opts);
  process.exit(code);
}
