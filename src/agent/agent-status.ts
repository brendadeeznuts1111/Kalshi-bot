/**
 * Local agent status from cache.db — no dashboard / rotor.
 */
import { loadLatestRunFromDb, loadFallbackRunFromDb } from "../research/cache.ts";
import { runDimension } from "../research/dimensions.ts";
import { resolveRunDataFreshness } from "./freshness.ts";
import type { ResearchRun } from "../research/types.ts";

export type AgentStatus = {
  latestRun: {
    runId: string;
    generatedAt: string;
    dimension: string;
    shortlist: number;
    discovered: number;
    gated: number;
    stale: boolean;
    ageMs: number | null;
    gateMiss: boolean;
    discoveryMiss: boolean;
  } | null;
  source: "cache.db";
};

function summarizeRun(run: ResearchRun) {
  const freshness = resolveRunDataFreshness(run);
  return {
    runId: run.runId,
    generatedAt: run.generatedAt,
    dimension: runDimension(run),
    shortlist: run.stats.shortlist,
    discovered: run.stats.discovered,
    gated: run.stats.gated,
    stale: freshness.stale,
    ageMs: freshness.ageMs,
    gateMiss: Boolean(run.gateMiss),
    discoveryMiss: Boolean(run.discoveryMiss),
  };
}

export function getAgentStatus(dimension?: string): AgentStatus {
  const run = dimension
    ? (loadLatestRunFromDb({ dimension }) ?? loadFallbackRunFromDb({ dimension }))
    : loadLatestRunFromDb();
  return {
    latestRun: run ? summarizeRun(run) : null,
    source: "cache.db",
  };
}

export function formatAgentStatus(status: AgentStatus): string {
  const lines = ["Kalshi agent status", `Source: ${status.source}`];
  if (!status.latestRun) {
    lines.push("Latest run: none — run: bun run research");
    return lines.join("\n");
  }
  const r = status.latestRun;
  const stale = r.stale ? " · stale" : "";
  lines.push(
    `Latest run: ${r.runId} (${r.generatedAt})`,
    `Dimension: ${r.dimension}`,
    `Discovered ${r.discovered} → gated ${r.gated} → shortlist ${r.shortlist}${stale}`,
  );
  if (r.gateMiss) lines.push("Gate miss: yes (see report / agent blueprint)");
  if (r.discoveryMiss) lines.push("Discovery miss: yes (see report)");
  return lines.join("\n");
}
