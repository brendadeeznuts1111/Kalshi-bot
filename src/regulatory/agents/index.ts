/**
 * agents/index.ts — Barrel export for regulatory agent team.
 */

export { AgentOrchestrator } from "./orchestrator.ts";
export type {
  AgentTask,
  AgentContext,
  AgentResult,
  Agent,
  BetCheckTask,
  SpikeDetectTask,
  MarketIngestTask,
  AdminActionTask,
  LineMoveEvalTask,
} from "./orchestrator.ts";

export { ComplianceAgent } from "./compliance-agent.ts";
export { OpsAgent } from "./ops-agent.ts";
export { MarketDataAgent } from "./market-data-agent.ts";
export { AdminAgent } from "./admin-agent.ts";
