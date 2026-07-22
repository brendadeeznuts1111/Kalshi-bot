// @see https://bun.com/docs/runtime/cron
// @see https://bun.com/blog/bun-v1.3.12#in-process-buncron-scheduler
import type { CliOptions } from "../research/cli.ts";
import { runResearch } from "../research/cli.ts";
import type { ResearchRun } from "../research/types.ts";
import {
  PULSE_PROBE_CRON_UTC,
  RESEARCH_CRON_IN_PROCESS_UTC,
} from "../research/constants.ts";
import { beginResearch, failResearch, finishResearch } from "./dashboard-state.ts";
import { latestPulseTick } from "./pulse-log.ts";

export type InProcessCronOptions = {
  /** Tail rotor pulse.log on {@link PULSE_PROBE_CRON_UTC}. */
  pulse?: boolean;
  /** Run full research in-process on {@link RESEARCH_CRON_IN_PROCESS_UTC} (UTC). */
  research?: boolean;
};

export type CronJobHandle = { [Symbol.dispose]?: () => void };

export type InProcessCronRegistration = {
  pulse?: CronJobHandle;
  research?: CronJobHandle;
};

let cronErrorsInstalled = false;

/** Install once — matches v1.3.12 cron error semantics (setTimeout-like). */
export function ensureInProcessCronErrorHandling(): void {
  if (cronErrorsInstalled) return;
  cronErrorsInstalled = true;
  process.on("unhandledRejection", (err) => {
    console.error("[kalshi-cron] unhandled rejection:", err);
  });
  process.on("uncaughtException", (err) => {
    console.error("[kalshi-cron] uncaught exception:", err);
  });
}

/** Test helper */
export function resetInProcessCronErrorHandling(): void {
  cronErrorsInstalled = false;
}

export async function runPulseProbeTick(): Promise<void> {
  try {
    const tick = await latestPulseTick();
    if (!tick) {
      console.error("[kalshi-cron] pulse probe: no ticks yet");
      return;
    }
    const status = tick.ok ? "ok" : "FAIL";
    console.error(
      `[kalshi-cron] pulse probe: ${status} · findings=${tick.findings} concepts=${tick.concepts} · ${tick.ts}`,
    );
    if (tick.errorCount > 0) {
      console.error(`[kalshi-cron] pulse errors: ${tick.errors.join("; ")}`);
    }
  } catch (err) {
    console.error("[kalshi-cron] pulse probe failed:", err);
  }
}

export type InProcessResearchDeps = {
  runResearch?: (opts: CliOptions) => Promise<ResearchRun>;
};

export async function runInProcessResearchTick(deps: InProcessResearchDeps = {}): Promise<void> {
  if (!beginResearch()) {
    console.error("[kalshi-cron] research skipped — another run is in progress");
    return;
  }

  const runFn = deps.runResearch ?? runResearch;

  try {
    const run = await runFn({
      json: false,
      exportAudit: Bun.env.RESEARCH_EXPORT_AUDIT === "1",
    });
    finishResearch(run.runId);
    console.error(
      `[kalshi-cron] research complete run=${run.runId} shortlist=${run.shortlist.length}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failResearch(message);
    console.error("[kalshi-cron] research failed:", message);
  }
}

function resolvePulseSchedule(): string {
  return Bun.env.DASHBOARD_CRON_PULSE?.trim() || PULSE_PROBE_CRON_UTC;
}

function resolveResearchScheduleUtc(): string {
  return Bun.env.DASHBOARD_CRON_RESEARCH?.trim() || RESEARCH_CRON_IN_PROCESS_UTC;
}

/**
 * Register in-process Bun.cron jobs (UTC, no overlap, shared module state).
 * Returns handles — use `using` or call `[Symbol.dispose]()` to stop.
 */
export function registerInProcessCron(opts: InProcessCronOptions): InProcessCronRegistration {
  ensureInProcessCronErrorHandling();
  const out: InProcessCronRegistration = {};

  if (opts.pulse) {
    const schedule = resolvePulseSchedule();
    out.pulse = Bun.cron(schedule, runPulseProbeTick);
    console.error(`[kalshi-cron] pulse probe registered (${schedule}, UTC)`);
  }

  if (opts.research) {
    const schedule = resolveResearchScheduleUtc();
    out.research = Bun.cron(schedule, runInProcessResearchTick);
    console.error(`[kalshi-cron] in-process research registered (${schedule}, UTC)`);
  }

  return out;
}

export function describeInProcessCron(opts: InProcessCronOptions): string[] {
  const lines: string[] = [];
  if (opts.pulse) lines.push(`pulse ${resolvePulseSchedule()} UTC`);
  if (opts.research) lines.push(`research ${resolveResearchScheduleUtc()} UTC`);
  return lines;
}
