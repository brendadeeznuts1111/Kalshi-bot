export type DashboardPhase = "idle" | "running-research" | "error";

export type DashboardState = {
  phase: DashboardPhase;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastRunId: string | null;
};

const initial: DashboardState = {
  phase: "idle",
  message: null,
  startedAt: null,
  finishedAt: null,
  lastRunId: null,
};

let state: DashboardState = { ...initial };
let researchBusy = false;

export function getDashboardState(): DashboardState {
  return { ...state };
}

export function isResearchBusy(): boolean {
  return researchBusy;
}

export function beginResearch(): boolean {
  if (researchBusy) return false;
  researchBusy = true;
  state = {
    phase: "running-research",
    message: "Discovering and scoring repos…",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastRunId: state.lastRunId,
  };
  return true;
}

export function finishResearch(runId: string): void {
  researchBusy = false;
  state = {
    phase: "idle",
    message: `Research complete: ${runId}`,
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    lastRunId: runId,
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
  };
}

/** Test helper — reset singleton state. */
export function resetDashboardState(): void {
  researchBusy = false;
  state = { ...initial };
}
