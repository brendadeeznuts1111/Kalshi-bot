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

## What is **not** odds (critical — re-verified live)

The Ultra UI shows Over/Under, prices (−115), and max bet. That does **not** mean
`stream-list-v2` carries those fields.

### Actual `stream-list-v2` shape (live 2026-08)

```json
{
  "sports": {
    "tennis": {
      "count": 33,
      "events": {
        "39778041": {
          "sport": "Tennis",
          "league": "ATT. Saransk",
          "competitiors": { "home": "…", "away": "…" },
          "stream_id": 39778041,
          "feed_id": 0,
          "donbest_id": "0",
          "donbest_id_multi": []
        }
      }
    }
  },
  "error": false,
  "modified_time": 1785844114526
}
```

| Claim (from HTML inference) | Live JSON fact |
|-----------------------------|----------------|
| Root `events[]` with `markets[]` / `lines[]` / `odds[]` | **Absent** |
| `homeTeam` / `awayTeam` / `startTime` | **Absent** (uses `competitiors.home/away`) |
| `price` / American odds | **Absent** |
| `limit.maxStake` | **Absent** |

Deep key scan for odds/market/line/price: **0 pricing hits** (only sport bucket name `american_football`).

So:

- `fetchEvents()` → coverage catalog only  
- `fetchMarkets()` → **throws** with schema diagnostic (do not invent prices)  
- `inspectStreamCapabilities()` / CLI prints the capability probe  

### Statscore `booked-events` (integrated — still not prices)

```text
GET https://api.statscore.com/v2/booked-events
  ?client_id=311&product=livescorepro&events_details=yes
  &client_event_id=19690946
Referer: https://plive.sportswidgets.pro/
```

| Fact | Live result |
|------|-------------|
| HTTP | 200 for valid `client_event_id` |
| Shape | `api.data.booked_events[]` |
| Fields | id, client_event_id, name, sport_*, competition_*, start_date, status_*, **bet_status** |
| American `price` / markets / lines | **Absent** |
| `product=odds` / `liveodds` | **400** “The selected product is invalid” for client_id=311 |

Adapter methods:

| Method | Behavior |
|--------|----------|
| `fetchBookedEvent(clientEventId)` | Metadata row (or null) |
| `listBookedEvents({ sport, limit })` | First page of booked events |
| `fetchOdds(clientEventId)` | **Throws** until payload has real prices |

### ID map (do not conflate)

| ID | Source | Example use |
|----|--------|-------------|
| `stream_id` | stream-list-v2 | Video / stream inventory |
| `feed_id` | stream-list-v2 | Often 0 or large int — not always client_event_id |
| `client_event_id` | Statscore / widget hash `#!event/…` | booked-events lookup |
| `statscore id` | booked_events[].id | Internal Statscore event id |
| `ls_id` | get_pushes (when path known) | Live score pushes |

### Bet ticket wire (captured place/open response)

```json
{
  "betGroups": [{
    "betGroupId": 307200153,
    "ticketNumber": 1036636660,
    "finalOdds": 1.8928569555282593,
    "risk": 68,
    "toWin": 60.71,
    "currency": "USD",
    "componentBets": [{
      "betId": 335749942,
      "eventId": 196878741,
      "periodId": "m",
      "marketId": "3",
      "key": "2",
      "team1": "Kyryl Darin",
      "team2": "Jiri Plachy",
      "finalOdds": 1.8928569555282593
    }]
  }],
  "e": 0,
  "d": ""
}
```

| Field | Meaning |
|-------|---------|
| `finalOdds` | **Decimal** (~1.89), not American |
| `risk` / `toWin` | Stake / profit |
| `eventId` + `marketId` + `key` + `periodId` | Selection coordinates |
| `e` | 0 = ok |

| API | Role |
|-----|------|
| `parseBetGroupsResponse` / `executionResultFromBetGroups` | Boundary parse |
| `interpretBetTicketResponse(wire)` | Offline → `PartnerExecutionResult` |
| `placeOrder` | Needs **POST URL** still; dry-run logs intent |

### Where pre-bet line prices still hide

1. XHR/WS **before** accept that returns board lines  
2. Pandora after streamToken  
3. Manager getGames / lines  

Do **not** merge stream-list or Statscore livescorepro into Kalshi `match_liquidity` as “odds”.

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
