# Fantasy402 Ultra Live partner adapter

Kalshi-bot partner surface for a **PPH / Fantasy402** dummy desk.

| Concern | Location |
|---------|----------|
| Adapter | `src/partner/fantasy-ultra/adapter.ts` |
| Cookie jar | `src/partner/fantasy-ultra/cookie-jar.ts` |
| Parse (boundary) | `src/partner/fantasy-ultra/parse.ts` |
| Types / interfaces | `src/partner/types.ts` |
| Env profile | `src/partner/account-profile.ts` |
| Smoke CLI | `bun run partner:test-fantasy` |

## Network-capture flow (implemented)

```text
1. POST /cloud/api/Provider/getUltraLiveURL
      → { URL: { DESKTOP, MOBILE } }   // hash already on query string
2. GET  DESKTOP live widget URL
      → warm Set-Cookie when present
3. POST /cloud/api/League/Get_SportsLeagues
      form: RRO=1&agentID=…&agentOwner=…&operation=Get_SportsLeagues
      → { Leagues: [ { SportType, SportSubType, … } ] }
4. GET  https://api-gs.player-us.xyz/stream-list-v2/?tv=usa
      → multi-sport stream/coverage catalog
5. POST /cloud/api/System/renewToken
      empty form body
      → { code: "<jwt>" }   // becomes Authorization Bearer
```

**Hash generation:** not reverse-engineered. Login returns the full signed live URL; we use it as-is.

## What works today

| Method | Status |
|--------|--------|
| `login()` | ✅ Ultra Live URLs + optional warm |
| `warmSession()` | ✅ GET DESKTOP widget |
| `fetchSports()` | ✅ Get_SportsLeagues |
| `fetchEvents({ sport })` | ✅ stream-list-v2 (coverage rows) |
| `renewToken()` | ✅ updates in-memory Bearer from `code` |
| `fetchLimits` | ⏳ stub |
| `placeOrder` | ⏳ blocked (need PlaceBet HAR) |

## What is **not** odds

`stream-list-v2` rows are `{ sport, league, competitiors, stream_id, feed_id }`.  
Do **not** merge into Kalshi `match_liquidity` until a real price/book wire is mapped.

## Credentials (never commit)

```bash
export FANTASY402_BEARER_TOKEN='…'   # browser JWT (short-lived; renew often)
export FANTASY402_CUSTOMER_ID='…'
export FANTASY402_AGENT_ID='…'
export FANTASY402_PASSWORD='…'
# optional
export FANTASY402_DOMAIN='https://fantasy402.com'
export FANTASY402_SKIN=2
export FANTASY402_CURRENCY=USD
```

```bash
bun run partner:test-fantasy
bun run partner:test-fantasy -- --sport=tennis --limit=5 --renew
bun test tests/partner/fantasy-ultra.test.ts
```

## Security

- Tokens/passwords must not land in git or fixtures.
- Prefer Proton Pass inject (`env.template` keys).
- Rotate any token pasted into chat or shell history.
- `renewToken` extends short JWT windows (~minutes); call before long loops.

## Still open (need capture)

| Missing | Action |
|---------|--------|
| PlaceBet / ticket POST | Place a tiny bet in the widget; capture URL + body |
| Real stake limits | Endpoint may sit under `betFactoryV2` or Manager APIs |
| Pandora WebSocket | `wss://pandora.ganchrow.com/socket.io/` + streamToken.php |
| Cloudflare cookies | Optional `cf_clearance` / `__cf_bm` if WAF blocks automation |
