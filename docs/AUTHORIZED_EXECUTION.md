# Authorized Partner Execution

Status: implemented, default off. This is the operational work card for the
authorization, Telegram approval, exposure reservation, Kalshi mapping, and
live HTTP orchestration layers.

## Authority boundary

Live provider placement follows one path:

```text
HTTP compliance
  → canonical partnerCode / outId / skin request
  → active SQLite authorization + immutable policy hash
  → fresh executable Kalshi book + live portfolio balance
  → integer stake caps + transactional exposure reservation
  → idempotent Kalshi V2 placement
  → confirmed, rejected, or unknown reservation + durable receipt
```

Skills, agent instructions, documentation, hooks, CI, and dashboard controls do
not grant trading permission. They can only inspect, test, or document this
path. Runtime permission comes from verified database state and the explicit
environment gates below.

## Runtime gates

| Gate | Expected behavior |
|------|-------------------|
| `KALSHI_AUTHORIZED_EXECUTION_ENABLED=1` | Opens the partner HTTP execution breaker; unset is dry-run/fail-closed |
| `KALSHI_ENV=demo` | Default provider host; does not require production arming |
| `KALSHI_ENV=prod` | Selects the production provider host |
| `KALSHI_PROD_ARMED=1` | Required in addition to `KALSHI_ENV=prod` |
| active authorization grant | Must match partner, out, skin, provider, currency, scope, validity, and policy hash |
| risk health | Must remain healthy before and during snapshot evaluation |

`KALSHI_ALPHA_LIVE` belongs to alpha programs and does not enable this route.

## Request contract

Live `POST /api/trading/order` requests require:

- `partnerCode`, canonical `outId`, active `skin`, `ticker`, and `outcome`
- integer `stakeMinorUnits` and `priceCents`
- an explicit, stable `Idempotency-Key`
- compliance fields and middleware context: state, node, sport, market, wager,
  and bet type

The route rejects post-only requests because the authorization snapshot binds
the order to immediately executable top-of-book liquidity.

## Credentials and provider state

Kalshi credentials resolve in this order:

1. out: `KALSHI_SPORTS_1_*`
2. partner: `KALSHI_SPORTS_*`
3. global fallback: `KALSHI_*`

The client cache fingerprints credential inputs and rebuilds automatically
after key rotation. Kalshi uses signed RSA requests rather than a refresh-token
flow; the live `/portfolio/balance` call proves the current credentials and
supplies available balance to the gate.

## Expected fail-closed outcomes

- Missing/mismatched partner, out, skin, provider, currency, or grant: denied.
- Stale/missing/crossed book, quote mismatch, unavailable balance, or unhealthy
  risk state: denied before reservation or provider placement.
- Known provider rejection: reservation failed and exposure released.
- Ambiguous provider outcome: reservation remains unknown and exposure remains
  held until the reconciler finds an exact deterministic client-order match.
- Missing, malformed, conflicting, or failed reconciliation evidence never
  releases exposure and never converts the reservation to a rejection.
- Fantasy402: HTTP 501 with no provider call.

Credit lines and dedicated partner wallets are not modeled in the current
registry, so the gate does not invent either. Available capacity is the live
Kalshi balance constrained by authorization, skin, daily, exposure, max-win,
and executable-liquidity limits.

## Operator proof

```bash
bun test tests/partner/authorization tests/partner/execution tests/research/trading-order.test.ts
bun run bun:ci
bun run partner:reconcile-kalshi -- --limit=100
```

`Bun.TOML.stringify` is optional on the stable runtime: the governed
`src/partner/toml-stringify.ts` boundary uses the native API when present and a
tested compatibility serializer otherwise.

The reconciler pages the active Kalshi order feed by ticker, matches the UUID
derived from the execution idempotency key, persists a sanitized provider
summary, and queues a deduplicated confirmation receipt. It is a bounded
one-shot operator command so scheduling policy can be added without changing
the execution authority boundary.

## Remaining work

- Add an operator-owned schedule for the one-shot reconciliation command after
  demo soak evidence establishes the desired cadence and alert thresholds.
- Keep Fantasy402 unwired until provider-side idempotency is proven.
- Add credit-line or dedicated-wallet accounting only when an owned domain
  contract and ledger source exist.
