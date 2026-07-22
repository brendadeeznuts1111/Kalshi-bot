import { DEFAULT_DIMENSION, normalizeDimensionId } from "../research/dimensions.ts";
import { listRunSummaries } from "../research/cache.ts";

export type DashboardPhase = "idle" | "running-research" | "error";

export type DashboardState = {
  phase: DashboardPhase;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastRunId: string | null;
  /** Operator-selected dimension (research + report routing). */
  activeDimension: string;
  /** Dimension of the most recently completed research run. */
  lastRunDimension: string | null;
};

const initial: DashboardState = {
  phase: "idle",
  message: null,
  startedAt: null,
  finishedAt: null,
  lastRunId: null,
  activeDimension: DEFAULT_DIMENSION,
  lastRunDimension: null,
};

let state: DashboardState = { ...initial };
let researchBusy = false;

export function getDashboardState(): DashboardState {
  return { ...state };
}

export function isResearchBusy(): boolean {
  return researchBusy;
}

/** Resolve dimension for dashboard pages (query → last run → state default). */
export function resolveDashboardDimension(queryDimension: string | null | undefined): string {
  if (queryDimension?.trim()) {
    const dim = normalizeDimensionId(queryDimension);
    setActiveDimension(dim);
    return dim;
  }
  if (state.lastRunDimension) {
    return normalizeDimensionId(state.lastRunDimension);
  }
  const latest = listRunSummaries(1)[0];
  if (latest?.dimension) {
    const dim = normalizeDimensionId(latest.dimension);
    setActiveDimension(dim);
    return dim;
  }
  return normalizeDimensionId(state.activeDimension);
}

export function setActiveDimension(dimension: string): void {
  state = { ...state, activeDimension: normalizeDimensionId(dimension) };
}

export function beginResearch(dimension?: string): boolean {
  if (researchBusy) return false;
  researchBusy = true;
  const dim = dimension ? normalizeDimensionId(dimension) : state.activeDimension;
  state = {
    phase: "running-research",
    message: `Discovering and scoring repos (dimension=${dim})…`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastRunId: state.lastRunId,
    activeDimension: dim,
    lastRunDimension: state.lastRunDimension,
  };
  return true;
}

export function finishResearch(runId: string, dimension?: string): void {
  researchBusy = false;
  const dim = dimension ? normalizeDimensionId(dimension) : state.activeDimension;
  state = {
    phase: "idle",
    message: `Research complete: ${runId}`,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    lastRunId: runId,
    activeDimension: dim,
    lastRunDimension: dim,
  };
}

export function failResearch(message: string): void {
  researchBusy = false;
  state = {
    phase: "error",
    message,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    lastRunId: state.lastRunId,
    activeDimension: state.activeDimension,
    lastRunDimension: state.lastRunDimension,
  };
}

/** Test helper — reset singleton state. */
export function resetDashboardState(): void {
  researchBusy = false;
  state = { ...initial };
}
