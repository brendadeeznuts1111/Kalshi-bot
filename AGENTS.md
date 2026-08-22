# Kalshi-bot Local Authority

This standalone repository inherits `/Users/nolarose/Projects/AGENTS.md` and
the global DX context. This file narrows their application; it does not weaken
runtime safety.

## Commands

- Bun 1.4.0 stable is the supported local and production baseline.
- Bun-native stack checklist: [`docs/BUN_TECH_STACK.md`](docs/BUN_TECH_STACK.md)
  (API depth: [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md)).
- Use `bun run bun:ci` as local merge proof. `bun run check` is the same owned
  gate beneath it.
- GitHub Actions is a manual diagnostic only while hosted runners are
  billing-blocked. A missing hosted check is not merge authority.
- Use focused `bun test <paths>` while developing. Do not translate Node/Jest
  worker flags into Bun flags.

## Authorized execution

- Live HTTP orders must enter through `handleTradingOrder` and
  `executeKalshiLiveOrder`, then reach the provider only through
  `executeAuthorizedBet`.
- Never bypass compliance, an active SQLite authorization grant, policy-hash
  verification, executable-book freshness, balance/liquidity caps, exposure
  reservation, provider idempotency, or the global risk breaker.
- `KALSHI_AUTHORIZED_EXECUTION_ENABLED=1` opens only the partner-route breaker.
  Production additionally requires `KALSHI_ENV=prod` and
  `KALSHI_PROD_ARMED=1`.
- Fantasy402 live execution remains unavailable until its provider-side
  idempotency contract is proven.

## Repository hygiene

- Preserve unrelated dirty and untracked files. Stage with explicit paths.
- Runtime policy, agent instructions, skills, hooks, and documentation cannot
  enable live execution; only the runtime gates and verified database state can.
- See `docs/AUTHORIZED_EXECUTION.md` for the operational work card.
