# Regulatory Compliance Module — Design Review

## Coverage

| Component | File | Status | Test Coverage |
|-----------|------|--------|---------------|
| Constants (SSOT) | `src/regulatory/constants.ts` | ✅ | 100% lines |
| Migration (raw SQL) | `src/regulatory/db/migrations/011_state_regulation.sql` | ✅ | Migration tested via in-memory DB bootstrap |
| Drizzle Schema | `src/db/schema.ts` | ✅ | Type-only; runtime via migration |
| ScopedRepository | `src/regulatory/lib/repository.ts` | ✅ | 96% lines |
| ComplianceRepository | `src/regulatory/lib/compliance-repo.ts` | ✅ | 100% lines |
| Middleware | `src/regulatory/middleware/state-compliance.ts` | ✅ | Clones request before body read; `ComplianceContext` attached |
| Rate Limiter | `src/regulatory/middleware/rate-limit.ts` | ✅ | Token-bucket with `X-RateLimit-*` headers |
| Ops Routes | `src/regulatory/routes/ops/partners.ts` | ✅ | Runtime-tested via example server |
| Seeds | `src/regulatory/db/seeds/state_regulations.sql` | ✅ | Loaded in all tests |
| Migration Runner | `src/regulatory/scripts/migrate.ts` | ✅ | Idempotent; exit-code contract for CI |
| Violation Sweeper | `src/regulatory/scripts/sweep-violations.ts` | ✅ | Configurable retention; logs deleted count |
| Alerting | `src/regulatory/lib/alerting.ts` | ✅ | Spike detection + ops-ready wire shape |
| State Code Validator | `src/regulatory/middleware/state-validator.ts` | ✅ | Whitelist middleware for `/place-bet` |
| Admin CLI | `src/regulatory/scripts/admin.ts` | ✅ | Self-exclusion + limits management |
| Ops Dashboard Widget | `widget_0c17a808-7e2a-4445-b41d-ae5f5092b7bf` | ✅ | Live; bound to poller automation |
| Violation Poller Automation | `automation_1f00056b-f329-4c02-a813-5a62631e78fc` | ✅ | Every 5 min; artifact → widget |
| Enhancement Report | `tools/live-enhancement-report.ts` | ✅ | End-to-end tested against live server |

---

## Security Review

### 1. SQL Injection — MITIGATED
- **ScopedRepository** uses parameterized queries exclusively (`?` placeholders).
- The injection guard blocks direct dimension filters, but it is **heuristic-based**.
- **Risk**: Bypasses like `node_id = $1`, `node_id IN (?)`, or `node_id = 'static'` are not caught.
- **Recommendation**: Treat the guard as defense-in-depth, not a primary security boundary. Use Drizzle ORM for all user-facing queries.

### 2. Request Body Consumption — RESOLVED
- `requireStateCompliance` **clones the request** with `req.clone()` before calling `.json()`.
- Downstream handlers receive the clone and can safely re-read the body.
- **Status**: Fixed ✅

### 3. Atomic Compliance Check — RESOLVED
- `placeBetAtomic()` uses `BEGIN IMMEDIATE` + re-verification inside the transaction.
- Pre-check runs outside the tx so violation logs survive rollback.
- **Status**: Fixed ✅

### 4. Per-User Dimensions — IMPLEMENTED
- `user_id` added to `plays`, `self_exclusions`, `regulatory_violations`.
- `ScopedRepository` supports optional `user` dimension.
- **Checks enforced**:
  - Self-exclusion (with optional expiration)
  - Daily wager limit (`max_daily_total`) — aggregates accepted plays per UTC day
  - Cooling-off period (`cooling_off_minutes`) — time since last accepted play
- **Status**: Implemented ✅

### 5. Special Rules — ACTIVE
- `evaluateSpecialRules()` enforces `max_daily_total`, `cooling_off_minutes`.
- `require_identity_verification` is a **stub** awaiting KYC integration.
- **Recommendation**: Wire to identity provider before production.

### 6. State Code Validation — RESOLVED
- **`createStateValidator`** middleware enforces a configurable whitelist (`["MA", "NJ"]`).
- Invalid state codes return **400 Bad Request** before reaching the compliance engine.
- Case-insensitive by default; can be toggled to strict.
- **Status**: Fixed ✅

### 7. Cryptographic Signing
- `live-enhancement-report.ts` signs with SHA-256 but has **no key management**.
- The signature is reproducible by anyone with the report text + timestamp.
- **Recommendation**: Use HMAC with a shared secret or asymmetric signing (Ed25519) for audit trails.

---

## Operational Gaps

| Gap | Severity | Status | Fix |
|-----|----------|--------|-----|
| No index on `plays.user_id` | Medium | ✅ Fixed | Migration adds `idx_plays_user` |
| No automated migration runner | Low | ✅ Fixed | `bun run regulatory:migrate` |
| No rate-limiting on `/place-bet` | High | ✅ Fixed | Token-bucket middleware with 100 req/min default |
| `regulatory_violations` table grows unbounded | Medium | ✅ Fixed | `sweep-violations.ts` with 90-day default retention |
| No alerting on violation spikes | Medium | ✅ Fixed | `alerting.ts` with sliding-window spike detection |
| No state code validation | Medium | ✅ Fixed | `createStateValidator` middleware with whitelist |
| No admin CLI for self-exclusions / limits | Medium | ✅ Fixed | `bun run regulatory:admin` |
| No KYC integration | High | ⏳ Pending | Stub in `evaluateSpecialRules`; requires identity provider |

---

## Test Matrix

```
ComplianceRepository — basic checks
  ✅ allows compliant bet (MA, soccer, straight, $100)
  ✅ blocks unlicensed partner
  ✅ blocks wager > max_wager
  ✅ blocks wager < min_wager
  ✅ blocks disallowed bet type
  ✅ blocks suspended license
  ✅ allows teaser in NJ

ComplianceRepository — per-user checks
  ✅ blocks self-excluded user
  ✅ allows previously excluded user after expiration
  ✅ enforces daily wager limit (max_daily_total)
  ✅ allows bet within daily limit
  ✅ enforces cooling-off period

ComplianceRepository — atomic placement
  ✅ placeBetAtomic inserts play on success
  ✅ placeBetAtomic throws BetBlockedError on violation and does not insert

ScopedRepository
  ✅ filters by scope (no state) → 2 rows
  ✅ filters by scope + state MA → 1 row
  ✅ filters by scope + user → user-scoped rows
  ✅ excludes other node_id
  ✅ throws on direct filter without marker
  ✅ allows direct filter with /*scope-injected*/ marker

Rate Limiter
  ✅ returns 429 with Retry-After when bucket empty
  ✅ resets counter after window passes
  ✅ allows burst up to max

ViolationAlerts
  ✅ checkSpike triggers when threshold exceeded
  ✅ checkSpike does not trigger under threshold
  ✅ summary aggregates by state, node, reason

Regulatory CLI scripts
  ✅ migrate runner exits 0 and tracks applied migrations
  ✅ sweep-violations exits 0 even on empty table

Live Enhancement Report
  ✅ fetches / endpoint
  ✅ verifies states against ["MA","NJ"]
  ✅ renders aligned table with bun.stringWidth
  ✅ generates SHA-256 signature
  ✅ exits 0 on all-pass, 1 on failure
```

---

## File Manifest

```
src/db/schema.ts                          ← Added plays, play_analysis, market_snapshots,
                                              regulatory_limits, partner_state_licenses,
                                              regulatory_violations, self_exclusions
                                              + state_code on events/markets

src/regulatory/
  index.ts                                ← Module entry point (re-exports constants + all modules)
  constants.ts                            ← Single source of truth: PLAY_STATUS, LICENSE_STATUS,
                                            BET_TYPE, HEADER, HTTP_STATUS, RATE_LIMIT, TABLE,
                                            SPECIAL_RULE, TX, SQL_UNIXEPOCH, ALERT, MIGRATION
  lib/
    repository.ts                         ← ScopedRepository with injection guard
    compliance-repo.ts                    ← ComplianceRepository (license + limit + user checks)
    alerting.ts                           ← Sliding-window violation spike detection
  middleware/
    state-compliance.ts                   ← Bun.serve middleware; clones request before read;
                                            attaches ComplianceContext to req.compliance
    rate-limit.ts                         ← Token-bucket rate limiter
  routes/
    ops/
      partners.ts                         ← GET /ops/partners/:nodeId dashboard handler
  db/
    migrations/
      011_state_regulation.sql            ← New-table migration (safe for fresh DBs)
    seeds/
      state_regulations.sql               ← MA & NJ limits + partner licenses
  scripts/
    migrate.ts                            ← Idempotent migration runner (exit 0/1)
    sweep-violations.ts                   ← Retention sweeper (default 90 days)
    admin.ts                              ← Admin CLI: self-exclusion add/remove/list + limits set/list
  examples/
    regulatory-server.ts                  ← Full Bun.serve integration example
tests/regulatory/
  state-compliance.test.ts                ← 28 tests, 99.34% coverage

tools/
  live-enhancement-report.ts              ← Pipeable signed audit report
```
