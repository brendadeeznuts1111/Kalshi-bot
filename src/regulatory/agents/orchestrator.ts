/**
 * Agent orchestrator — central coordinator for regulatory multi-agent system.
 *
 * Dispatches tasks to specialized agents and collects results.
 * Each agent implements Agent<Ctx> and reports back via AgentResult.
 */

import { Database } from "bun:sqlite";
import { AGENT_ROLE } from "../constants";

// ── Core types ──

export type AgentTask =
  | { type: "COMPLIANCE_CHECK"; payload: BetCheckTask }
  | { type: "SPIKE_DETECT"; payload: SpikeDetectTask }
  | { type: "MARKET_INGEST"; payload: MarketIngestTask }
  | { type: "ADMIN_ACTION"; payload: AdminActionTask }
  | { type: "LINE_MOVE_EVAL"; payload: LineMoveEvalTask };

export interface BetCheckTask {
  nodeId: string;
  userId: string;
  stateCode: string;
  sportId: string;
  marketId: string;
  wagerAmount: number;
  betType: string;
  playId: string;
}

export interface SpikeDetectTask {
  windowSeconds?: number;
  threshold?: number;
}

export interface MarketIngestTask {
  slugs?: string[];        // specific markets; empty = all active
  fetchLimit?: number;
}

export interface AdminActionTask {
  action: "self_exclude" | "remove_exclusion" | "set_limit" | "get_status";
  nodeId: string;
  userId: string;
  payload?: Record<string, unknown>;
}

export interface LineMoveEvalTask {
  slug: string;
  oldPrice: number;
  newPrice: number;
  deltaBp: number;
  detectedAt: number;
}

export type AgentResult = {
  role: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
};

export type AgentContext = {
  db: Database;
  now: number;
  traceId: string;
};

export interface Agent<Ctx extends AgentContext = AgentContext> {
  readonly role: string;
  run(task: AgentTask, ctx: Ctx): Promise<AgentResult>;
}

// ── Orchestrator ──

export class AgentOrchestrator {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.agents.set(agent.role, agent);
  }

  /** Dispatch a single task to its assigned agent and return the result. */
  async dispatch(task: AgentTask, ctx: AgentContext): Promise<AgentResult> {
    const role = taskTypeToRole(task.type);
    const agent = this.agents.get(role);
    if (!agent) {
      return {
        role,
        ok: false,
        error: `No agent registered for role: ${role}`,
        latencyMs: 0,
      };
    }
    const start = performance.now();
    try {
      const result = await agent.run(task, ctx);
      result.latencyMs = Math.round(performance.now() - start);
      return result;
    } catch (err) {
      return {
        role,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Math.round(performance.now() - start),
      };
    }
  }

  /** Dispatch multiple tasks in parallel, returning ordered results. */
  async dispatchAll(tasks: AgentTask[], ctx: AgentContext): Promise<AgentResult[]> {
    return Promise.all(tasks.map((t) => this.dispatch(t, ctx)));
  }

  /** Run a full compliance pipeline: ingest market data → check spike → evaluate line moves. */
  async runCompliancePipeline(ctx: AgentContext): Promise<AgentResult[]> {
    const tasks: AgentTask[] = [
      { type: "MARKET_INGEST", payload: {} },
      { type: "SPIKE_DETECT", payload: {} },
    ];
    return this.dispatchAll(tasks, ctx);
  }

  listRoles(): string[] {
    return Array.from(this.agents.keys());
  }
}

function taskTypeToRole(type: AgentTask["type"]): string {
  switch (type) {
    case "COMPLIANCE_CHECK":
      return AGENT_ROLE.COMPLIANCE;
    case "SPIKE_DETECT":
      return AGENT_ROLE.OPS;
    case "MARKET_INGEST":
      return AGENT_ROLE.MARKET_DATA;
    case "ADMIN_ACTION":
      return AGENT_ROLE.ADMIN;
    case "LINE_MOVE_EVAL":
      return AGENT_ROLE.COMPLIANCE;
  }
}
