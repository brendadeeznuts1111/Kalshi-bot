# Fantasy402 Ultra Live partner adapter

Kalshi-bot partner surface for a **PPH / Fantasy402** dummy desk.

| Concern | Location |
|---------|----------|
| Adapter | `src/partner/fantasy-ultra/adapter.ts` |
| Parse (boundary) | `src/partner/fantasy-ultra/parse.ts` |
| Types / interface | `src/partner/types.ts` |
| Env profile | `src/partner/account-profile.ts` |
| Smoke CLI | `bun run partner:test-fantasy` |

## What works today

1. **Login** — `POST /cloud/api/Provider/getUltraLiveURL`  
   Response shape:
   ```json
   { "URL": { "DESKTOP": "https://plive.sportswidgets.pro/live/?…", "MOBILE": "…" } }
   ```
2. **Live catalog** — `GET https://api-gs.player-us.xyz/stream-list-v2/?tv=usa`  
   Multi-sport stream/coverage list (tennis, football, …).  
   **This is not a price book** — rows are `{ sport, league, competitiors, stream_id, feed_id }`.

## What is intentionally stubbed

| Method | Status |
|--------|--------|
| `fetchLimits` | Stub (`maxStake: 0`, note) |
| `placeOrder` | Blocked — no bet ticket wire mapped yet |

Do **not** merge partner stream rows into Kalshi `match_liquidity` until odds (not just streams) are available.

## Credentials (never commit)

```bash
export FANTASY402_BEARER_TOKEN='…'   # browser JWT
export FANTASY402_CUSTOMER_ID='…'
export FANTASY402_AGENT_ID='…'
export FANTASY402_PASSWORD='…'
# optional
export FANTASY402_DOMAIN='https://fantasy402.com'
export FANTASY402_SKIN=2
export FANTASY402_CURRENCY=USD
```

Then:

```bash
bun run partner:test-fantasy
bun run partner:test-fantasy -- --sport=tennis --limit=5
bun test tests/partner/fantasy-ultra.test.ts
```

`env.template` documents Proton-ready keys; values stay in vault / local `.env`.

## Security

- Tokens and passwords must **not** land in git, fixtures with real JWT, or commit messages.
- Prefer Proton Pass inject for durable custody.
- Rotate any token that was pasted into chat or shell history.
