/**
 * Local agent status from cache.db — no dashboard / rotor.
 */
import {
  loadLatestProductionRunAnyDimension,
  loadLatestRunFromDb,
} from "../research/cache.ts";
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
  /** Set when `--dimension` was requested but no run exists for that slice. */
  requestedDimension?: string;
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

/**
 * Latest production run. With `dimension`, only that slice (no cross-dimension fallback).
 * Without `dimension`, newest production run across all dimensions.
 */
export function getAgentStatus(dimension?: string): AgentStatus {
  const requested = dimension?.trim();
  if (requested) {
    const run = loadLatestRunFromDb({ dimension: requested });
    return {
      latestRun: run ? summarizeRun(run) : null,
      requestedDimension: requested,
      source: "cache.db",
    };
  }
  const run = loadLatestProductionRunAnyDimension();
  return {
    latestRun: run ? summarizeRun(run) : null,
    source: "cache.db",
  };
}

export function formatAgentStatus(
  status: AgentStatus,
  options?: { compact?: boolean },
): string {
  const compact = options?.compact === true;
  const lines = compact
    ? ["(embedded status)"]
    : ["Kalshi agent status", `Source: ${status.source}`];
  if (!status.latestRun) {
    if (status.requestedDimension) {
      lines.push(`Latest run: none for dimension=${status.requestedDimension}`);
      if (!compact) {
        lines.push(
          `Run: bun run research -- --dimension=${status.requestedDimension}`,
          `Offline probe: bun run research:dry -- --dimension=${status.requestedDimension}`,
          `Triage: bun run agent ground --dimension=${status.requestedDimension}`,
        );
      }
    } else if (compact) {
      lines.push("Latest run: none");
    } else {
      lines.push(
        "Latest run: none — run: bun run research",
        "Triage: bun run agent ground",
      );
    }
    return lines.join("\n");
  }
  const r = status.latestRun;
  const stale = r.stale ? " · stale" : "";
  lines.push(
    `Latest run: ${r.runId} (${r.generatedAt})`,
    `Dimension: ${r.dimension}`,
    `Discovered ${r.discovered} → gated ${r.gated} → shortlist ${r.shortlist}${stale}`,
  );
  if (r.gateMiss) {
    lines.push("Gate miss: yes");
    if (!compact) {
      lines.push(`Triage: bun run agent ground --dimension=${r.dimension}`);
    }
  }
  if (r.discoveryMiss) {
    lines.push("Discovery miss: yes");
    if (!compact) {
      lines.push(`Triage: bun run agent ground --dimension=${r.dimension}`);
    }
  }
  return lines.join("\n");
}
