// @see https://bun.com/docs/runtime/cron
// @see https://bun.com/docs/guides/process/argv
/**
 * In-process toxicity sweep — polls every N seconds for lines in the T+60s mark window.
 * Use while shadow-running live: bun run calibration:toxicity:loop
 */
import { runToxicitySweep } from "./shadow-maintenance.ts";

const DEFAULT_INTERVAL_SEC = 15;

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function runToxicityLoop(intervalSec = DEFAULT_INTERVAL_SEC): Promise<never> {
  console.error(
    `[kalshi-toxicity] loop every ${intervalSec}s — marks only in T+60s window (not stale mids)`,
  );
  for (;;) {
    const results = await runToxicitySweep();
    for (const row of results) {
      if (row.marked > 0) {
        console.log(
          `Toxicity ${row.program}: marked=${row.marked} pending=${row.pending} missed=${row.missed}`,
        );
      }
    }
    await Bun.sleep(intervalSec * 1000);
  }
}

if (import.meta.main) {
  const intervalArg = arg("interval");
  const intervalSec = intervalArg ? Number(intervalArg) : DEFAULT_INTERVAL_SEC;
  if (!Number.isFinite(intervalSec) || intervalSec < 5) {
    console.error("Usage: bun src/calibration/toxicity-loop.ts [--interval=15]");
    process.exit(1);
  }
  await runToxicityLoop(intervalSec);
}
