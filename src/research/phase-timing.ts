// @see https://bun.com/docs/runtime/utils#bun-nanoseconds
/** High-precision phase timings for the research pipeline. */

export type ResearchPhase = "discover" | "gate" | "inspect" | "score" | "write";

export type PhaseTimingsMs = Partial<Record<ResearchPhase, number>>;

const PHASE_ORDER: ResearchPhase[] = ["discover", "gate", "inspect", "score", "write"];

export function createPhaseTimer(): {
  start: (phase: ResearchPhase) => void;
  end: (phase: ResearchPhase) => void;
  snapshot: () => PhaseTimingsMs;
} {
  const starts = new Map<ResearchPhase, number>();
  const timings: PhaseTimingsMs = {};

  return {
    start(phase: ResearchPhase): void {
      // Bun.nanoseconds() is process uptime — elapsed = end − start.
      starts.set(phase, Bun.nanoseconds());
    },
    end(phase: ResearchPhase): void {
      const t0 = starts.get(phase);
      if (t0 === undefined) return;
      timings[phase] = Math.round((Bun.nanoseconds() - t0) / 1e6);
      starts.delete(phase);
    },
    snapshot(): PhaseTimingsMs {
      return { ...timings };
    },
  };
}

/** Format ms for operator logs — sub-second stays in ms. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatPhaseTimings(timings: PhaseTimingsMs): string {
  const parts: string[] = [];
  let total = 0;
  for (const phase of PHASE_ORDER) {
    const ms = timings[phase];
    if (ms === undefined) continue;
    total += ms;
    parts.push(`${phase} ${formatDurationMs(ms)}`);
  }
  if (!parts.length) return "";
  return `Timing: ${parts.join(", ")} (${formatDurationMs(total)} total)`;
}

/** Rows for `Bun.inspect.table` — phase + human duration. */
export function phaseTimingTableRows(
  timings: PhaseTimingsMs,
): Array<{ phase: string; duration: string }> {
  const rows: Array<{ phase: string; duration: string }> = [];
  let total = 0;
  for (const phase of PHASE_ORDER) {
    const ms = timings[phase];
    if (ms === undefined) continue;
    total += ms;
    rows.push({ phase, duration: formatDurationMs(ms) });
  }
  if (rows.length) rows.push({ phase: "total", duration: formatDurationMs(total) });
  return rows;
}
