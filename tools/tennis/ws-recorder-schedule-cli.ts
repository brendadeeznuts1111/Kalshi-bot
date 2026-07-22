#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron#bun-cron-path-schedule-title-os-level
/**
 * Register / remove / preview the tennis WS orderbook recorder (OS Bun.cron).
 *
 * Default: every 30 minutes — 5m capture per fire during match windows.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { previewFireTimes } from "../../src/research/schedule-cli.ts";

/** Every 30m local — dense enough for watch-set book_ticks during match hours. */
export const TENNIS_WS_RECORDER_CRON_SCHEDULE = "*/30 * * * *";
export const TENNIS_WS_RECORDER_CRON_TITLE = "kalshi-tennis-ws-recorder";
export const TENNIS_WS_RECORDER_DEFAULT_WS_SECONDS = 300;
export const TENNIS_WS_RECORDER_WORKER_PATH = join(
  import.meta.dir,
  "ws-recorder-scheduled.ts",
);

export type TennisWsRecorderScheduleCommand = "register" | "remove" | "preview";

export function resolveWsRecorderWsSeconds(raw?: string): number {
  const fromEnv = Bun.env.TENNIS_WS_RECORDER_WS_SECONDS?.trim();
  const candidate = raw?.trim() || fromEnv || String(TENNIS_WS_RECORDER_DEFAULT_WS_SECONDS);
  const n = Number(candidate);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : TENNIS_WS_RECORDER_DEFAULT_WS_SECONDS;
}

export function parseWsRecorderScheduleCli(argv: string[]): {
  command: TennisWsRecorderScheduleCommand;
  schedule: string;
  title: string;
  count: number;
  wsSeconds: number;
} | null {
  const positional = argv.filter((a) => !a.startsWith("-"));
  const command = positional[0] as TennisWsRecorderScheduleCommand | undefined;
  if (!command || !["register", "remove", "preview"].includes(command)) {
    return null;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      schedule: { type: "string" },
      title: { type: "string" },
      count: { type: "string", default: "3" },
      "ws-seconds": { type: "string" },
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
        : Bun.env.TENNIS_WS_RECORDER_CRON_SCHEDULE?.trim() || TENNIS_WS_RECORDER_CRON_SCHEDULE,
    title:
      typeof values.title === "string"
        ? values.title
        : Bun.env.TENNIS_WS_RECORDER_CRON_TITLE?.trim() || TENNIS_WS_RECORDER_CRON_TITLE,
    count,
    wsSeconds: resolveWsRecorderWsSeconds(
      typeof values["ws-seconds"] === "string" ? values["ws-seconds"] : undefined,
    ),
  };
}

if (import.meta.main) {
  const opts = parseWsRecorderScheduleCli(Bun.argv.slice(2));
  if (!opts) {
    console.error(
      "Usage: bun tools/tennis/ws-recorder-schedule-cli.ts <register|remove|preview> [--schedule='*/30 * * * *'] [--ws-seconds=300]",
    );
    process.exit(1);
  }

  switch (opts.command) {
    case "register": {
      await Bun.cron(TENNIS_WS_RECORDER_WORKER_PATH, opts.schedule, opts.title);
      console.log(`Registered OS cron job "${opts.title}"`);
      console.log(`  worker: ${TENNIS_WS_RECORDER_WORKER_PATH}`);
      console.log(`  schedule: ${opts.schedule} (system local time)`);
      console.log(`  ws-seconds: ${opts.wsSeconds} (override: TENNIS_WS_RECORDER_WS_SECONDS)`);
      console.log(`  logs (macOS): /tmp/bun.cron.${opts.title}.stdout.log`);
      console.log(`  manual: bun run tennis:record -- --ws --ws-seconds=${opts.wsSeconds}`);
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
      console.log(`WS seconds: ${opts.wsSeconds}`);
      console.log(`Next ${times.length} fire(s) (UTC, Bun.cron.parse):`);
      for (const [i, d] of times.entries()) {
        console.log(`  ${i + 1}. ${d.toISOString()}`);
      }
      break;
    }
  }
}
