// @see https://bun.com/docs/runtime/http/fetch
import { loadLatestRunFromDb } from "../research/cache.ts";
import { DASHBOARD_ROUTES } from "./dashboard-views.ts";
import { latestPulseTick, pulseLogPath } from "./pulse-log.ts";
import { getDashboardState } from "./dashboard-state.ts";
import { verificationSummaryForRun, type VerificationSummary } from "./audit-list.ts";

export type AgentStatusPayload = {
  source: "dashboard-api" | "local";
  dashboardUrl: string | null;
  state: ReturnType<typeof getDashboardState>;
  busy: boolean;
  latestRun: {
    runId: string;
    generatedAt: string;
    shortlist: number;
  } | null;
  pulse: Awaited<ReturnType<typeof latestPulseTick>>;
  pulseLog: string;
  verification: VerificationSummary | null;
};

export function dashboardBaseUrl(): string {
  const explicit = Bun.env.DASHBOARD_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const port = Bun.env.DASHBOARD_PORT?.trim() || "3457";
  return `http://127.0.0.1:${port}`;
}

export async function fetchDashboardJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const url = `${dashboardBaseUrl()}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(Number(Bun.env.DASHBOARD_FETCH_TIMEOUT_MS ?? 5000)),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type RemoteStatus = {
  state: AgentStatusPayload["state"];
  busy: boolean;
  latestRun: AgentStatusPayload["latestRun"];
  pulse: AgentStatusPayload["pulse"];
  pulseLog: string;
  verification?: VerificationSummary | null;
};

async function localVerificationSummary(): Promise<VerificationSummary | null> {
  const run = loadLatestRunFromDb();
  if (!run) return null;
  return verificationSummaryForRun(run);
}

export async function getAgentStatus(): Promise<AgentStatusPayload> {
  const remote = await fetchDashboardJson<RemoteStatus>(DASHBOARD_ROUTES.status);
  if (remote) {
    const verification =
      remote.verification ?? (await localVerificationSummary());
    return {
      source: "dashboard-api",
      dashboardUrl: dashboardBaseUrl(),
      ...remote,
      verification,
    };
  }

  const run = loadLatestRunFromDb();
  const pulse = await latestPulseTick();
  const verification = run ? await verificationSummaryForRun(run) : null;
  return {
    source: "local",
    dashboardUrl: null,
    state: getDashboardState(),
    busy: false,
    latestRun: run
      ? { runId: run.runId, generatedAt: run.generatedAt, shortlist: run.stats.shortlist }
      : null,
    pulse,
    pulseLog: pulseLogPath(),
    verification,
  };
}

export type RunResearchResponse = {
  ok: boolean;
  runId?: string;
  shortlist?: number;
  generatedAt?: string;
  error?: string;
  source: "dashboard-api" | "local";
};

export async function triggerResearchViaApi(): Promise<RunResearchResponse | null> {
  const remote = await fetchDashboardJson<RunResearchResponse>(DASHBOARD_ROUTES.runResearch, {
    method: "POST",
  });
  if (!remote) return null;
  return { ...remote, source: "dashboard-api" };
}

export function formatVerificationSummaryLine(summary: VerificationSummary | null): string | null {
  if (!summary) return null;
  if (!summary.catalogAvailable) {
    return summary.warning ?? "Rotor catalog unavailable — all shortlist repos unverified";
  }
  return `Rotor verification: ${summary.verified} verified, ${summary.watchlist} watchlist, ${summary.unverified} unverified`;
}

export function formatAgentStatus(status: AgentStatusPayload): string {
  const lines = [
    `Agent status (${status.source})`,
    status.dashboardUrl ? `Dashboard: ${status.dashboardUrl}` : "Dashboard: not reachable (local read)",
    `Phase: ${status.state.phase}${status.busy ? " (busy)" : ""}`,
  ];

  if (status.latestRun) {
    lines.push(
      `Latest run: ${status.latestRun.runId} · ${status.latestRun.generatedAt} · shortlist ${status.latestRun.shortlist}`,
    );
  } else {
    lines.push("Latest run: none");
  }

  const verifyLine = formatVerificationSummaryLine(status.verification);
  if (verifyLine) lines.push(verifyLine);

  if (status.pulse) {
    lines.push(
      `Pulse: ${status.pulse.ok ? "ok" : "FAIL"} · ${status.pulse.findings} findings · ${status.pulse.ts}`,
    );
  } else {
    lines.push(`Pulse: no ticks (${status.pulseLog})`);
  }

  if (status.state.message) lines.push(`Message: ${status.state.message}`);
  return lines.join("\n");
}
