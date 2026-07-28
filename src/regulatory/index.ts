/**
 * src/regulatory/index.ts
 * Regulatory compliance module — entry point.
 *
 * Re-exports:
 *   - Constants (PLAY_STATUS, LICENSE_STATUS, BET_TYPE, HEADER, HTTP_STATUS, etc.)
 *   - ScopedRepository, Scope, ScopedRow
 *   - ComplianceRepository, BetCheckParams, BetCheckResult, BetBlockedError
 *   - requireStateCompliance middleware + ComplianceContext
 *   - createRateLimiter middleware
 *   - ViolationAlerts
 *   - partnerDetailHandler route
 *   - Polymarket integration (fetchers, line tracker)
 *   - Agent team (orchestrator, compliance, ops, market-data, admin)
 *
 * Usage:
 *   import { ComplianceRepository, requireStateCompliance, createRateLimiter, PLAY_STATUS } from "./regulatory";
 */

export {
  PLAY_STATUS,
  LICENSE_STATUS,
  BET_TYPE,
  HEADER,
  CONTENT_TYPE,
  HTTP_STATUS,
  RATE_LIMIT,
  DEFAULT_USER_ID,
  SCOPE_INJECTION_MARKER,
  ALERT,
  TABLE,
  SPECIAL_RULE,
  TX,
  SQL_UNIXEPOCH,
  MIGRATION,
  POLYMARKET,
  AGENT_ROLE,
} from "./constants";

export {
  ScopedRepository,
  type Scope,
  type ScopedRow,
} from "./lib/repository";

export {
  ComplianceRepository,
  BetBlockedError,
  type BetCheckParams,
  type BetCheckResult,
} from "./lib/compliance-repo";

export {
  requireStateCompliance,
  type BetRequestBody,
  type ComplianceContext,
} from "./middleware/state-compliance";

export {
  createRateLimiter,
  type RateLimitOptions,
} from "./middleware/rate-limit";

export {
  ViolationAlerts,
  type SpikeCheckOptions,
  type SpikeResult,
  type ViolationSummary,
} from "./lib/alerting";

export {
  partnerDetailHandler,
  type PartnerDetailFilters,
} from "./routes/ops/partners";

export {
  createStateValidator,
  type StateValidatorOptions,
} from './middleware/state-validator';

// ── Polymarket integration ──
export {
  fetchPolymarketMarkets,
  fetchPolymarketMarket,
  marketToTick,
  PolymarketLineTracker,
  type PolymarketMarket,
  type PolymarketTick,
  type PolymarketLineMove,
  type PolymarketClientOptions,
  type FetchMarketsOptions,
} from "./integrations/polymarket";

// ── Agent team ──
export {
  AgentOrchestrator,
  ComplianceAgent,
  OpsAgent,
  MarketDataAgent,
  AdminAgent,
  type AgentTask,
  type AgentContext,
  type AgentResult,
  type Agent,
  type BetCheckTask,
  type SpikeDetectTask,
  type MarketIngestTask,
  type AdminActionTask,
  type LineMoveEvalTask,
} from "./agents";
