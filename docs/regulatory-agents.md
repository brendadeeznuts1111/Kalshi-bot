# Regulatory Multi-Agent System

## Overview

A role-based multi-agent regulatory compliance system with Polymarket integration for live market data, line-movement detection, and steam-bet alerting.

## Agent Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Orchestrator  │────▶│  Compliance     │     │  Market Data    │
│                 │     │  Agent          │     │  Agent          │
│  dispatch()     │     │                 │     │                 │
│  dispatchAll()  │     │  • Bet validate │     │  • Gamma API    │
│  runPipeline()  │     │  • Steam detect │     │  • Tick store   │
└─────────────────┘     │  • Violation log│     │  • Line tracker │
        │               └─────────────────┘     └─────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     Ops Agent   │     │  SQLite DB      │     │   Admin Agent   │
│                 │     │                 │     │                 │
│  • Spike detect │     │  • plays        │     │  • Self-exclude │
│  • Summaries    │     │  • violations   │     │  • Limit mgmt   │
│  • Dashboard    │     │  • polymarket_* │     │  • User status  │
└─────────────────┘     │  • audit_log    │     └─────────────────┘
                        └─────────────────┘
```

## Agent Roles

| Role | File | Key Method | Responsibility |
|------|------|------------|----------------|
| `orchestrator` | `agents/orchestrator.ts` | `dispatch()`, `runCompliancePipeline()` | Central coordinator, task routing |
| `compliance` | `agents/compliance-agent.ts` | `isBetAllowed()`, `evaluateMarketIntegrityRules()` | Bet validation, steam detection |
| `ops` | `agents/ops-agent.ts` | `checkSpike()`, `summary()` | Violation spike alerts, dashboard data |
| `market_data` | `agents/market-data-agent.ts` | `ingest()`, `latestTicks()` | Polymarket fetch, tick storage, line moves |
| `admin` | `agents/admin-agent.ts` | `self_exclude`, `set_limit`, `get_status` | User management, limit configuration |

## Polymarket Integration

### Gamma API Endpoints

```
GET https://gamma-api.polymarket.com/markets?limit={n}&active=true
GET https://gamma-api.polymarket.com/markets/{id}
```

No authentication required for public market data.

### Line-Movement Detection

`PolymarketLineTracker` flags moves when **all** conditions are met:

1. **Price delta** ≥ `deltaBpThreshold` (default: 500 bp = 5%)
2. **24h volume** ≥ `minVolume24hr` (default: $1,000)
3. **Spread** ≤ `maxSpread` (default: 0.05 = 5¢)
4. Within `windowSeconds` (default: 300s) of baseline tick

### Steam Detection

When a line move is detected, the Compliance Agent checks for bets placed in the `STEAM_LOOKBACK_SECONDS` window (default: 60s) before the move. Any matching bets are flagged as violations in `regulatory_violations` with reason `"Steam alert: {slug} moved {deltaBp} bp within 60s of bet"`.

## Typed Error Hierarchy

All errors extend `RegulatoryError` with a canonical `code` and optional `context`.

```ts
// Bet lifecycle
class BetBlockedError extends RegulatoryError          // code: "BET_BLOCKED"
class BetTypeNotAllowedError extends RegulatoryError     // code: "BET_TYPE_NOT_ALLOWED"
class WagerOutOfBoundsError extends RegulatoryError      // code: "WAGER_OUT_OF_BOUNDS"

// User / identity
class SelfExcludedError extends RegulatoryError          // code: "SELF_EXCLUDED"
class IdentityVerificationError extends RegulatoryError  // code: "IDENTITY_VERIFICATION_REQUIRED"

// License
class LicenseError extends RegulatoryError               // code: "LICENSE_INVALID"

// Rate limiting
class RateLimitError extends RegulatoryError             // code: "RATE_LIMITED"

// Market data
class PolymarketApiError extends RegulatoryError         // code: "POLYMARKET_API_ERROR"
class SteamAlertError extends RegulatoryError            // code: "STEAM_ALERT"
class MarketDataStaleError extends RegulatoryError       // code: "MARKET_DATA_STALE"

// Agent / orchestration
class AgentNotFoundError extends RegulatoryError         // code: "AGENT_NOT_FOUND"
class AgentTaskError extends RegulatoryError             // code: "AGENT_TASK_FAILED"

// Database
class MigrationError extends RegulatoryError             // code: "MIGRATION_FAILED"
class DatabaseIntegrityError extends RegulatoryError     // code: "DB_INTEGRITY"
```

## Audit Trail

Every significant action is logged to `regulatory_audit_log` with:

```ts
interface AuditEntry {
  traceId: string;       // Correlates across agents in a pipeline
  actor: string;         // e.g. "compliance-agent", "market-data-agent"
  action: string;        // e.g. "BET_PLACED", "LINE_MOVE_DETECTED"
  target?: string;       // e.g. "play-123", "will-it-rain"
  outcome: "ok" | "blocked" | "error" | "flagged";
  details?: Record<string, unknown>;
  latencyMs?: number;
}
```

Convenience methods:
- `audit.logBet(traceId, playId, userId, outcome, details, latencyMs)`
- `audit.logLineMove(traceId, slug, deltaBp, volumeAtMove, latencyMs)`
- `audit.logDispatch(traceId, role, taskType, outcome, latencyMs)`

## CLI Scripts (with Bun.color ANSI output)

### Admin CLI
```bash
bun src/regulatory/scripts/admin.ts self-exclusion add \
  --user user-1 --node partner-alpha --reason "cooling-off"

bun src/regulatory/scripts/admin.ts limits set \
  --state MA --sport soccer --market match_winner \
  --max-wager 5000 --min-wager 1 --bet-types '["straight"]'
```

Output is colorized with ✓/✖ indicators, bold table headers, and dimmed empty states.

### Migration Runner
```bash
bun src/regulatory/scripts/migrate.ts --db ./data/regulatory.db
```

Shows pending migrations with → progress indicators and green ✓ on success.

### Violation Sweeper
```bash
bun src/regulatory/scripts/sweep-violations.ts --db ./data/regulatory.db --retention-days 90
```

Color-coded deletion counts: orange for deletions, dim gray for zero.

## Database Schema

### New Tables (Migration 012)

```sql
-- Polymarket market metadata cache
polymarket_markets (slug PK, question, condition_id, volume, volume_24hr, liquidity, active, closed)

-- Time-series price snapshots
polymarket_ticks (id, slug, yes_price, no_price, best_bid, best_ask, spread, volume_24hr, timestamp)

-- Detected line moves
polymarket_line_moves (id, slug, direction, old_price, new_price, delta_bp, detected_at)

-- Immutable audit trail
regulatory_audit_log (id, trace_id, actor, action, target, outcome, details, latency_ms, created_at)
```

## API Endpoints

| Method | Path | Handler | Agent |
|--------|------|---------|-------|
| `POST` | `/place-bet` | `handlePlaceBet` | Compliance |
| `GET`  | `/ops/partners/:nodeId` | `partnerDetailHandler` | Ops |
| `POST` | `/polymarket/ingest` | `handlePolymarketIngest` | MarketData |
| `GET`  | `/polymarket/status` | `handlePolymarketStatus` | Orchestrator |
| `GET`  | `/polymarket/ticks` | `handlePolymarketTicks` | MarketData |
| `GET`  | `/polymarket/line-moves` | `handlePolymarketLineMoves` | MarketData |
| `POST` | `/agent/dispatch` | `handleAgentDispatch` | Orchestrator |

## Widget Dashboard

The Regulatory Ops Dashboard widget displays:

1. **Agent Team Status** — Live pills showing each agent's health
2. **Violation Overview** — Spike count, totals, top state/reason
3. **Violation Heatmap** — State × Node matrix with color-coded cells (green → yellow → red)
4. **Recent Violations** — Time-ordered table
5. **Polymarket Intelligence** — Markets tracked, line moves, steam alerts
6. **Market Comparison Matrix** — Yes/No prices, spread, volume bars, liquidity bars, signal badges
7. **Recent Line Moves** — Direction, old→new, delta in bp
8. **Audit Trail** — Actor, action, target, outcome badges, latency

## Automations

| Automation | Trigger | Purpose |
|------------|---------|---------|
| **Polymarket Market Ingest** | Every 3 min | Fetches Gamma API, stores ticks, detects line moves, flags steam |
| **Regulatory Violation Poller** | Every 5 min | Reads DB, produces dashboard artifact with violations + Polymarket data |

## Constants Reference

```ts
POLYMARKET = {
  DEFAULT_DELTA_BP_THRESHOLD: 500,      // 5% move
  DEFAULT_MIN_VOLUME_24HR: 1_000,
  DEFAULT_TRACKING_WINDOW_SECONDS: 300, // 5 min
  DEFAULT_MAX_SPREAD: 0.05,
  DEFAULT_FETCH_LIMIT: 50,
  STEAM_LOOKBACK_SECONDS: 60,
}

AGENT_ROLE = {
  COMPLIANCE: "compliance",
  OPS: "ops",
  MARKET_DATA: "market_data",
  ADMIN: "admin",
  ORCHESTRATOR: "orchestrator",
}
```

## Test Coverage

Run regulatory tests:
```bash
bun test tests/regulatory/
```

New test file: `tests/regulatory/polymarket-agents.test.ts` — 18 tests covering:
- Polymarket API normalization (JSON string parsing, number coercion)
- Line tracker threshold/volume/spread gating
- Agent orchestrator dispatch + parallel pipelines
- Compliance agent steam detection with DB-backed violations
- Market data agent ingest + tick persistence
- Admin agent roundtrips (self-exclusion, limit setting, status query)
- End-to-end compliance pipeline
