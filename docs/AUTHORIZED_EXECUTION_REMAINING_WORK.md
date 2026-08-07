# Authorized Execution — Delivery Record and Graduation Gate

Status: implementation waves closed on 2026-08-06. Production arming remains
blocked only by the real-time graduation gate described below. This file keeps
the completed dependency and ownership plan as an audit record; sections under
Waves 0–3 are delivered specifications, not an active task queue unless the
closure audit explicitly marks a row open.

The existing safety boundary remains authoritative: documentation, agents, CI,
and schedules cannot enable trading. Keep `KALSHI_AUTHORIZED_EXECUTION_ENABLED`
unset for live funds until every P0 item and the demo graduation proof below
pass.

Implementation update (2026-08-06): Waves 0–2 and the Wave 3 authoritative demo
evidence collector, deterministic failure-scenario runner, daily evidence
compiler, and seven-day chain verifier are merged into `main`: operator
principals, regulatory lifecycle/sync,
leased reconciliation and stale recovery, full Kalshi evidence binding,
fail-closed risk health, authorized cancellation, independent workers, canonical
provider lifecycle, and the immutable journal. The collector binds
cursor-complete demo-provider evidence to SQLite reservations, lifecycle rows,
receipts, and journal projections, then emits a redacted chained daily artifact.
The only open graduation requirement is seven consecutive real elapsed demo days
with reviewed artifacts. This status does not arm production.

## Delivery order

```text
Wave 0: shared contracts
  operator principal · lifecycle states · reconciliation migration · risk signals
        │
Wave 1: parallel safety lanes
  HTTP/auth + cancel  │  reconciliation evidence  │  worker/health plumbing
        └─────────────┴────────────────────────────┘
                              │
Wave 2: provider lifecycle + immutable ledger
                              │
Wave 3: demo soak, reconciliation proof, production review
```

During delivery, one integration owner controlled shared types and migrations;
parallel lanes claimed disjoint file sets and handed focused proof back for
integration.

## Current closure audit

| Lane | State | Authoritative implementation evidence |
| --- | --- | --- |
| W0 operator identity | closed | `src/research/trading-auth.ts`; actor-bound order/cancel rows and route tests |
| W0 regulatory lifecycle | closed | proposed/confirmed/rejected/unknown play lifecycle, reservation binding, and execution-play sync |
| W0 reconciliation/risk | closed | migrations, leased claims, stored fail-closed health signals, stable risk codes |
| W1 authenticated cancellation | closed | `executeAuthorizedCancel`, scoped credentials, current grant/risk recheck, durable intent/receipt |
| W1 stale placement/evidence | closed | stale placing recovery plus cursor-complete active/historical exact-term reconciliation |
| W1 workers/alerts | closed | independent reconcile/lifecycle/receipt jobs, Bun cron register/remove/preview, deduplicated breaker receipts |
| W2 provider lifecycle | closed | cursor-complete account order/fill ingestion, canonical provider direction, strict primary-account identity, exact minor-unit fees, and provider-positive settlement accounting |
| W2 immutable projections | closed | append-only integer journal, deterministic source keys, reversals, partner/out/skin projections and drift |
| W3 tooling | closed | authoritative demo collector, deterministic service scenarios, daily compiler, seven-day chain verifier |
| W3 elapsed graduation | **open** | seven consecutive real passing demo days and human artifact review have not elapsed |

“Closed” above means the repository behavior and focused proof exist. It does
not mean production is armed. The elapsed graduation row is intentionally open
and cannot be closed with generated fixtures or accelerated time.

## Wave 0 — shared contracts

### W0.1 Operator principal and role contract — P0

Owner: HTTP security agent.

Files:

- `src/research/serve.ts`
- new authentication boundary and tests under `src/research/` and
  `tests/research/`

Scope:

- Authenticate every live order and cancellation request.
- Bind an immutable actor ID, role, partner, and allowed outs to the request.
- Reject body/header identity spoofing.
- Require CSRF/origin protection if browser cookies are used; otherwise use an
  explicit bearer/service credential contract.
- Persist actor provenance on execution and cancellation records.

Acceptance:

- Missing/invalid credentials never reach compliance or a provider.
- Read-only and cross-partner actors cannot order or cancel.
- Body `userId` and `x-user-id` cannot replace the authenticated actor.
- Dry-run authentication policy is explicit and tested.

### W0.2 Regulatory execution lifecycle — P0

Owner: compliance agent.

Files:

- `src/regulatory/middleware/state-compliance.ts`
- `src/regulatory/lib/compliance-repo.ts`
- regulatory schema/constants/tests

Scope:

- Replace pre-provider `accepted` insertion with
  `proposed → confirmed | rejected | unknown` transitions.
- Link the regulatory play uniquely to execution idempotency and reservation.
- Count proposed/unknown exposure toward safety limits, while reporting
  confirmed turnover separately.
- Let reconciliation finalize an unknown play exactly once.

Acceptance:

- Provider rejection never remains accepted.
- Ambiguous dispatch remains unknown and exposure-bearing.
- Exact reconciliation moves unknown to confirmed idempotently.
- DB/provider failures cannot create a confirmed play without a confirmed
  reservation.

### W0.3 Reconciliation persistence contract — P0

Owner: execution DB agent. Integration owner approves the migration shape before
other reconciliation work begins.

Implementation status: built on the reconciliation PR with migration 003, owner
leases, attempt/retry metadata, fair claims, guarded completion, and atomic
confirmation plus receipt persistence. Stale-`placing` recovery remains in Lane
B.

Files:

- `src/partner/execution/sql.ts`
- `src/partner/execution/reservation.ts`
- `src/partner/execution/domain.ts`
- reservation/migration tests

Add:

- reconciliation owner and lease expiry
- attempt count, last/next attempt timestamps
- bounded sanitized result and error fields
- provider/status/due/lease eligibility index
- transactional bounded claim and owner-checked completion APIs

Acceptance:

- Two workers cannot claim the same reservation.
- Expired leases are reclaimable; stale owners cannot complete work.
- Claim, retry, error, and conflict never release unknown exposure.
- Migration upgrades v002 and remains idempotent.

### W0.4 Execution risk-health contract — P0

Owner: risk agent.

Files:

- `src/partner/risk-health.ts`
- `src/partner/execution/kalshi-live.ts`
- runtime wiring and focused tests

Signals:

- global and per-out kill switches
- execution enable/prod-arm gates
- provider session/health
- stale executable book
- unknown/stale-placing age and count
- balance versus local exposure drift
- migration, maintenance, and telemetry health

Acceptance:

- Every unhealthy signal blocks before provider dispatch with a stable code.
- Missing telemetry/configuration fails closed.
- Threshold breach disables the affected out; global breach blocks all outs.
- Demo/production arming truth table is covered.

## Wave 1 — parallel safety lanes

### Lane A: authenticated HTTP and authorized cancellation — P0

Owner: HTTP/execution agent. Depends on W0.1 and the lifecycle identity agreed
with W0.2.

Files:

- `src/research/serve.ts`
- new cancellation service under `src/partner/execution/`
- `tests/research/trading-order.test.ts`
- new authentication/cancellation tests

Scope:

- Replace raw global-client cancellation with `executeAuthorizedCancel`.
- Resolve provider ticket → reservation → partner/out/skin/account.
- Revalidate operator scope, current authorization, risk state, execution
  breaker, and production arming.
- Use out-scoped credentials.
- Persist idempotent cancellation intent, confirmed/rejected/unknown result,
  actor provenance, and receipt.
- Make DB ownership explicit: the server owns long-lived handles and closes them
  on shutdown; handler-created fallbacks close in `finally`.

Acceptance:

- Unknown and cross-out order IDs are denied before provider access.
- Duplicate cancellation is idempotent.
- Provider timeout remains ambiguous and exposure-bearing.
- Injected DBs remain open; internally owned DBs close on every path.
- Repeated request tests show no connection/descriptor growth.

### Lane B: fair unknown/stale-placing reconciliation — P0

Owner: execution DB agent. Depends on W0.3.

Files:

- `src/partner/execution/reservation.ts`
- `src/partner/execution/reconciliation.ts`
- `src/partner/execution/maintenance.ts`
- focused execution tests

Scope:

- Atomically recover stale Kalshi `placing` rows to exposure-bearing `unknown`.
- Preserve placement provenance and record `STALE_PLACING_RECOVERY`.
- Select due work by next-attempt time, not unchanged creation/update age.
- Persist every outcome: confirmed, not-found, conflict, malformed, or lookup
  error.
- Apply deterministic capped backoff and expose oldest/due/leased metrics.
- Never auto-reject from provider absence alone.

Acceptance:

- Fresh placing rows remain untouched; stale rows recover idempotently.
- More than one batch of unresolved rows cannot starve newer work.
- Transient failures retry with bounded backoff.
- Conflict/error diagnostics are bounded and secret-free.

### Lane C: complete Kalshi evidence and term binding — P0/P1

Owner: Kalshi API agent. May proceed alongside Lane B after W0.3 interfaces are
stable.

Files:

- `src/bot/kalshi-client.ts`
- `src/partner/execution/kalshi.ts`
- `src/partner/execution/reconciliation.ts` integration adapter
- Kalshi client/adapter tests

Scope:

- Normalize active and historical order lookup with bounded cursor pagination.
- Distinguish found, conclusively exhausted, incomplete, malformed, and
  provider-error results.
- Share one expected-order projection between placement and reconciliation.
- Verify ticker, deterministic client ID, outcome/book side, original count,
  limit price, account, and environment.

Acceptance:

- Resting, partial, filled, cancelled, and historical orders are discoverable.
- Pagination limits are incomplete/error, never not-found.
- Wrong side, price, count, ticker, client ID, account, or environment cannot
  confirm.
- YES/NO fixed-point and book-side transformations normalize consistently.

### Lane D: independent workers, health, and alerts — P1

Owner: operations/Telegram agent. Depends on W0.3 metrics and stable Lane B
claim APIs.

Files:

- reconciliation and outbox one-shot workers
- OS `Bun.cron` register/remove/preview commands
- `src/partner/execution/maintenance.ts`
- Telegram receipt/alert tests and runbook

Scope:

- Keep bounded one-shot commands as the worker unit.
- Schedule reconciliation and receipt delivery independently of Telegram long
  polling.
- Emit structured metrics for oldest placing/unknown/outbox age, backlog by out,
  attempts/errors, fill lag, and balance drift.
- Add deduplicated reconciliation-conflict and breaker receipts.

Demo defaults:

- reconcile every minute
- warn when unknown age exceeds two minutes
- disable the affected out at five minutes
- global breaker for persistent provider errors or unexplained balance drift

Acceptance:

- Overlapping fires are safe through DB leases.
- Bot downtime does not prevent later exactly-once receipt delivery.
- Poison receipts dead-letter without starving other work.
- Fatal worker failures and policy breaches return nonzero status.

## Wave 2 — provider lifecycle and finance

### W2.1 Typed order/fill/cancel/settlement lifecycle — P1

Owner: provider lifecycle agent.

Scope:

- Add cursor-complete account-scoped order and fill readers.
- Reuse canonical normalized order/fill types instead of persisting raw wire
  objects.
- Store fill rows idempotently by provider source key.
- Model ordered, filled, remaining, cancelled, and settled quantities.
- Release only unfilled working exposure on cancellation; retain filled position
  exposure until provider-positive settlement.

Acceptance scenarios:

- 10 ordered / 4 filled / 6 resting tracks exact working and position exposure.
- Cancelling that order releases only 6; cancelled-unfilled releases all.
- Delayed or repeated fill pages never undercount or double count.
- Settlement is idempotent and requires provider-positive evidence.

### W2.2 Immutable execution journal and partner projections — P1

Owner: finance/ledger agent. Starts only after W2.1 defines canonical lifecycle
events.

Scope:

- Add integer-minor-unit journal entries for reservation, order, fill, fee,
  cancellation, settlement, and adjustment/reversal.
- Use deterministic unique source keys; correct mistakes with reversals rather
  than mutation.
- Project cash, open exposure, realized P&L, fees, and partner split by
  partner/out/skin.
- Reconcile projections with provider balance and positions and alert on drift.
- Keep the legacy Fantasy ticket ledger behind an explicit adapter.

Acceptance:

- Duplicate fills/settlements do not double count.
- YES/NO win/loss, partial-fill, and fee matrices are exact integers.
- Journal sums reproduce projections.
- Provider balance/position drift is detected within an owned tolerance.

## Wave 3 — demo graduation proof

Owner: QA/operations agent after Waves 0–2.

Build a demo-only scenario runner and redacted daily JSON/Markdown artifact
covering local reservations, provider orders/fills/positions, journal totals,
orphan counts, balance drift, and maximum reconciliation/receipt lag.

Graduation requires seven consecutive days with:

- zero unexplained provider or local orphan orders
- zero unexplained balance/position drift
- every unknown resolved or manually accounted for within the owned SLA
- demonstrated idempotency under duplicate requests
- demonstrated recovery from crash-after-dispatch, timeout, partial fill,
  cancellation, and Telegram outage
- production breakers still defaulting closed

Production arming is a separate reviewed decision; passing the soak does not
change flags automatically.

## Documentation and governance cleanup

Owner: documentation/governance agent after each behavior lands.

- Keep `docs/AUTHORIZED_EXECUTION.md`, `docs/PARTNER-DOMAIN.md`, and
  `src/partner/domain.ts` aligned with actual maturity.
- Separate Kalshi authorized execution from Fantasy402 HAR-only status.
- Add lifecycle and breaker recovery diagrams plus operator runbooks.
- Verify every documented command exists.
- Run focused tests, pre-commit, and `bun run bun:ci` for every integration
  commit.

## Suggested sub-agent allocation

After Wave 0 interface review:

| Agent                 | Primary ownership                                                  | Must not edit without coordination           |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| A — HTTP/compliance   | principal middleware, route/cancel service, regulatory transitions | reconciliation schema and Kalshi wire parser |
| B — reconciliation DB | migrations, leases, claims, retry state, stale placing             | HTTP routes and ledger projections           |
| C — Kalshi/operations | normalized lookup, term projection, workers, schedules, alerts     | regulatory schema and finance journal        |
| Integration owner     | shared domain types, interface resolution, final proof             | no unrelated cleanup                         |

The finance/ledger and demo-soak lanes begin only after the canonical provider
lifecycle event contract is merged.
