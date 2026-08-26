#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs } from "node:util";
import { previewFireTimes } from "../src/research/schedule-cli.ts";

export const EXECUTION_RECONCILE_TITLE = "kalshi-partner-reconcile";
export const EXECUTION_RECEIPTS_TITLE = "kalshi-partner-receipts";
export const EXECUTION_LIFECYCLE_TITLE = "kalshi-partner-lifecycle";
export const EXECUTION_RECONCILE_WORKER = join(import.meta.dir, "partner-reconcile-scheduled.ts");
export const EXECUTION_RECEIPTS_WORKER = join(import.meta.dir, "partner-receipts-scheduled.ts");
export const EXECUTION_LIFECYCLE_WORKER = join(import.meta.dir, "partner-lifecycle-scheduled.ts");

export function parseExecutionScheduleArgs(argv: string[]) {
  const { positionals } = parseArgs({ args: argv, options: {}, strict: false, allowPositionals: true });
  const command = positionals[0];
  if (command !== "register" && command !== "remove" && command !== "preview") return null;
  const { values } = parseArgs({
    args: argv.slice(1), strict: false,
    options: { schedule: { type: "string" }, count: { type: "string", default: "3" } },
  });
  const count = Math.max(1, Math.floor(Number(values.count) || 3));
  return {
    command,
    schedule: typeof values.schedule === "string" ? values.schedule : "* * * * *",
    count,
  } as const;
}

if (import.meta.main) {
  const options = parseExecutionScheduleArgs(Bun.argv.slice(2));
  if (!options) {
    console.error("Usage: partner-execution-schedule <register|remove|preview> [--schedule='* * * * *']");
    process.exit(1);
  }
  if (options.command === "register") {
    await Bun.cron(EXECUTION_RECONCILE_WORKER, options.schedule, EXECUTION_RECONCILE_TITLE);
    await Bun.cron(EXECUTION_RECEIPTS_WORKER, options.schedule, EXECUTION_RECEIPTS_TITLE);
    await Bun.cron(EXECUTION_LIFECYCLE_WORKER, options.schedule, EXECUTION_LIFECYCLE_TITLE);
    console.log(`Registered ${EXECUTION_RECONCILE_TITLE}, ${EXECUTION_RECEIPTS_TITLE}, and ${EXECUTION_LIFECYCLE_TITLE}`);
  } else if (options.command === "remove") {
    await Bun.cron.remove(EXECUTION_RECONCILE_TITLE);
    await Bun.cron.remove(EXECUTION_RECEIPTS_TITLE);
    await Bun.cron.remove(EXECUTION_LIFECYCLE_TITLE);
    console.log("Removed partner execution workers");
  } else {
    console.log(JSON.stringify({
      schedule: options.schedule,
      reconcileTitle: EXECUTION_RECONCILE_TITLE,
      receiptsTitle: EXECUTION_RECEIPTS_TITLE,
      lifecycleTitle: EXECUTION_LIFECYCLE_TITLE,
      fires: previewFireTimes(options.schedule, options.count).map(date => date.toISOString()),
    }, null, 2));
  }
}
