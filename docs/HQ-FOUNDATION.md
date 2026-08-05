# HQ Foundation — Order of Operations & Agent Team Spec

Status: draft · 2026-07-28 · Owner: nolarose
Scope: turn `http://localhost:3456/hq` into the permanent headquarters for
research, enhancement (code-lift), and trading for the Kalshi bot.

---

## 0. Where we are now

Canonical references: [GLOSSARY.md](GLOSSARY.md) (data dictionary) ·
[DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) (tokens/components) ·
[OFFICIAL_URLS.md](OFFICIAL_URLS.md) (external links).

Already landed (this session):

- `/hq` dashboard — Overview / Research / Trading / Alpha & Calibration / Ops tabs
- `/api/hq` — aggregate JSON data plane (failure-isolated sections)
- Trading: balance / positions / orders / fills, order entry (dry-run default),
  cancel, orderbook preview (`/api/trading/book`, public market data)
- All writes behind rate-limiter → state-validator → compliance-gate stack

Existing subsystems the HQ must unify (already built, partially wired):

| Subsystem | Where | State |
|---|---|---|
| GitHub bot discovery & scoring | `src/research/*` | working, stale runs (07-22) |
| Enhancement pipeline (lift candidates) | `src/research/inspect.ts`, `docs/` | manual |
| Kalshi REST/WS client | `src/bot/*` | working |
| Alpha programs ×4 | `alpha/*` | shadow, tennis-game-model logging |
| Calibration | `src/calibration/*`, `calibration/artifacts` | running |
| Tennis event store + live scores | `src/institutions/event-store`, `tools/tennis/*` | cron via launchd |
| Regulatory agents | `src/regulatory/agents` | orchestrator live in server |
| Ops page | `/ops` | working |

---

## 1. Recommended order of operations (foundation-first)

The rule: **no live size until the layer below it is observable in HQ.**
Each step ends with something visible on the dashboard — that is the gate.

### Phase 1 — Freshness & truth (data you can trust) ← DO FIRST
1. Re-run research pipeline (`bun run research`) so HQ shows current candidates, not 07-22.
2. Register the research schedule (`bun run schedule:register`) so runs stay fresh.
3. HQ "freshness bar": every section shows data age; anything older than its
   cadence gets a `stale` badge. *Without this, every later decision rests on
   unknown-age data.*

### Phase 2 — Enhancement pipeline (research → code)
4. Spec the lift workflow per shortlisted repo: inspect → evidence → extract
   module → port into `src/` with tests → diff report. (`docs/AUDIT_ADAPTER.md`
   and inspect evidence already exist — formalize the states.)
5. HQ "Enhancements" tab: pipeline board (discovered → inspecting → lifting →
   ported → verified) driven by a `research/enhancements.json` registry.

### Phase 3 — Trading observability (before any automation)
6. Persist orders/fills/positions snapshots into a local SQLite table
   (`src/db`) on each `/api/hq` trading fetch — gives P&L history and
   exposure-over-time charts without new API surface.
7. HQ Trading tab: exposure chart, fill P&L, per-market position detail.

### Phase 4 — Shadow → pilot graduation (the actual goal)
8. Wire alpha gate progress as first-class HQ widgets (signals X/400,
   weeks Y/2, Brier drift) with a graduation checklist per program.
9. Pilot mode: when gates pass, HQ offers "promote to pilot" — capped size
   (pilotMaxContracts=5), every pilot order still dry-run-default with an
   explicit promote flag.

### Phase 5 — Automation with guardrails
10. Strategy runner loop (alpha signals → order proposals, NOT orders) shown
    in HQ as a proposal queue; human or policy approves → order endpoint.
11. Kill-switch: one config flag + one HQ button halts all automated order
    flow (checked inside `/api/trading/order`).

Do not start Phase 5 before Phase 3 is live. Do not trade live size before
Phase 4 gates pass on real resolved data.

---

## 2. Agent team spec

Extend the existing `AgentOrchestrator` (`src/regulatory/agents`) pattern —
roles registered, tasks dispatched with traceId, all surfaced in HQ.

| Agent | Role | Inputs | Outputs | Cadence |
|---|---|---|---|---|
| `compliance` (exists) | Gate all order flow | order requests, state regs | allow/block + violation log | per-request |
| `ops` (exists) | Infra health, alerts | violation alerts, cron logs | alerts | per-request |
| `market_data` (exists) | Polymarket/tick ingest | market APIs | ticks, line moves | scheduled |
| `admin` (exists) | DB maintenance | regDb | migrations, cleanup | manual |
| **research-scout** (new) | Run discovery, score, shortlist | GitHub API | research runs | daily cron |
| **design** (live) | Branding, tokens, component registry, view audits | rendered HTML | `/api/design` manifest, `/api/design/audit` (see [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)) | per-request |
| **enhancement-lifter** (new) | Extract & port modules from shortlisted repos | shortlist + evidence | PR-ready module + tests | on proposal |
| **risk-sentinel** (new) | Exposure limits, kill-switch authority | positions, balance, fills | block orders over limit; trip kill-switch | per-request (before compliance) |
| **alpha-evaluator** (new) | Gate math per program (Brier, edge/fill, drift) | shadow logs, calibration | graduation verdicts | hourly |
| **strategy-runner** (new, Phase 5) | Signal → order proposal queue | alpha signals, books | proposals (never direct orders) | loop |

Dispatch rules:

- Only `risk-sentinel` + `compliance` sit on the synchronous order path.
  Everything else is async and cannot block trading.
- `strategy-runner` never calls `placeOrder`. It writes proposals; the order
  endpoint is the single choke point where dry-run default, risk-sentinel,
  and compliance all apply. One door in.
- Every agent task logs to a `agent_runs` table; HQ Agents tab renders
  last-run status per role (the Orchestrator panel exists — extend it).

---

## 3. Immediate next actions (this week)

1. `bun run research` → fresh shortlist in HQ.
2. Freshness bar in `/api/hq` + stale badges (small, high value).
3. Trading snapshot persistence (`hq_trading_snapshots` table) → P&L chart.
4. `research/enhancements.json` registry + Enhancements tab skeleton.

Each is independently shippable, ≤1 file pair (data + view), following the
`hq-data.ts` / `hq-view.ts` split.
