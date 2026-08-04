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
bun run partner:watch-events -- --once --sport=table_tennis --json
bun run partner:watch-events -- --loop --sport=table_tennis --interval-ms=30000
bun test tests/partner/fantasy-ultra.test.ts tests/partner/partner-events-store.test.ts
```

## Detect new table tennis events

**Primary feed:** `GET https://api-gs.player-us.xyz/stream-list-v2/?tv=usa`  
**Bucket:** `sports.table_tennis.events` — **not** `sports.tennis` (court tennis).

| Bucket | Live sample | `event.sport` |
|--------|-------------|---------------|
| `tennis` | ~45 | Tennis |
| `table_tennis` | ~33 | Table Tennis |

`partner_events` table (created with event-store schema) stores stream inventory:

| Column | Source |
|--------|--------|
| `partner` + `stream_id` | UNIQUE key (detection key) |
| sport / league / home / away | stream-list (`competitiors` typo upstream) |
| `client_event_id` / `ls_id` | nullable until mapping exists |

```bash
# one-shot (inventory is public — dummy env is fine)
export FANTASY402_BEARER_TOKEN=x FANTASY402_CUSTOMER_ID=x FANTASY402_AGENT_ID=x FANTASY402_PASSWORD=x
bun run partner:watch-events -- --once --sport=table_tennis --json

# long poll every 30s (default)
bun run partner:watch-events -- --loop --sport=table_tennis --interval-ms=30000
```

New rows print as `+ Table Tennis · …`. Optional Telegram: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.

```text
stream-list-v2  ──every 30s──▶  new stream_id?  ──▶  partner_events + notify
                                      │
                                      ▼ (optional, needs real auth)
                              get_pushes / booked-events / PlaceBet
```

### get_pushes (stats — not for discovery)

```
https://events-d.pc.statscore.com/get_pushes/{stream_id}?messageId=…&auth=…&poll=true
```

Live probe: **403 Forbidden** without a valid session `auth`. Use stream-list for detection only.

**Not auto-filled:** `client_event_id` / odds — stream-list has no prices; enrich later.

## Widget runtime config (HTML source)

| Setting | Value | Implication |
|---------|-------|-------------|
| `sportOrder` | `[214, 1, 2, 4, 220]` | UI only; 214 = favorites |
| Table tennis widget id | **220** | Sidebar |
| Table tennis API / ticket `sportId` | **93** | betGroups, Get_SportsLeagues |
| stream-list bucket | `table_tennis` | Detection |
| `customWebSocketUrl` | `wss://pandora.ganchrow.com` | Live odds (message format **not** captured yet) |
| `oddsFormat` | `american` | Display/wire preference |
| `roundUSOddsDown` | `true` | Use `roundUsOddsDown` / `normalizeOdds` |
| `oddsDecimalPlaces` | `3` | Truncate decimals |
| `liveStreamLastWagerToleranceSec` | `86400` | Stream UI soft gate (not data sync) |

```ts
import { fantasySportByApiId, normalizeOdds, FANTASY_WIDGET_CONFIG } from "./src/partner/index.ts";
fantasySportByApiId(93); // table_tennis, widget 220
normalizeOdds(1.8928, "decimal"); // dual american + truncated decimal
// WS: FANTASY_WIDGET_CONFIG.customWebSocketUrl — connect after capturing message schema
```

`bun run partner:registry -- --seed` also seeds `provider_sport_mappings`.

### Pandora Socket.IO (live odds transport)

```text
wss://pandora.ganchrow.com/socket.io/?EIO=4&transport=websocket
```

| Handshake (live-probed) | Meaning |
|-------------------------|---------|
| `← 0{sid,pingInterval,…}` | Engine.IO open |
| `→ 40` | Socket.IO connect `/` |
| `← 40{sid}` | namespace connected |
| `← 2` / `→ 3` | ping / pong |

```bash
# Handshake only
bun run partner:pandora-probe -- --seconds=12
# Full plive subscribe sequence (captured via WebView CDP)
bun run partner:pandora-probe -- --plive --seconds=15
# Automated CDP capture from the widget (writes JSONL under research/cache/)
bun run partner:webview-ws-capture -- --seconds=20
```

**Captured subscribe emits (plive anonymous):**
```text
42["setSocketMetadata",{"partnerId":"118","flavor":"live"}]
42["subscribeSystemEvents",{"partnerId":"118","groupId":97360}]
42["subscribe",["live.sports"]]
42["subscribe",["live.leagues"]]
42["subscribe",["live.wagerTypes"]]
42["subscribe",["live.main.U0VWU1NWUkJSMFU9.eventData"]]
42["subscribe",["live.main.U0VWU1NWUkJSMFU9.eventCoefficients.{eventId}"]]
```

Large payloads arrive as Socket.IO binary attachments (`451-` + gzip/base64 body).  
Still needed: **decode eventCoefficients → American prices** for `tradable`.

Code: `PandoraSocket` · `buildPliveSubscribeSequence` · `Bun.WebView` capture tool.

## Liquidity sources map (partners / outs / providers)

| Entity | Table / type | Role |
|--------|--------------|------|
| **Partner** | `partners` | Financial owner (profit split, commission) |
| **Account (out)** | `betting_accounts` | Place to bet: provider + limits + `env_prefix` for secrets |
| **Provider** | adapter id (`fantasy402`, `kalshi`) | Book / feed implementation |
| **Stream inventory** | `partner_events` | Detected events (not priced book) |
| **Desk liquidity** | `match_liquidity` | Kalshi-priced gates (`tradable` / `liq_ok`) |

```bash
# Seed BB55113-style out from env (no secrets in DB)
export FANTASY402_CUSTOMER_ID=BB55113 FANTASY402_MAX_STAKE=1000 FANTASY402_MAX_WIN=5000
bun run partner:registry -- --seed --json
```

**Capacity** = Σ `max_stake` per provider across active accounts.  
That is **not** market `tradable` — only stake capacity until a priced line exists.

| Ready | Not ready |
|-------|-----------|
| Registry + capacity rollup | Partner markets in `liquidity:ground` |
| Fantasy402 inventory sync | Concentration scoring from DB accounts |
| Ticket response parse | placeOrder POST |

## Unified sync module (ground truth)

```bash
bun run partner:sync -- --sport=table_tennis --once --json
bun run partner:sync -- --sport=table_tennis --loop --interval-ms=30000
bun run partner:sync -- --enrich-booked --once   # soft name→client_event_id (metadata only)

# In-process cron (with other desk jobs)
PARTNER_SYNC=1 PARTNER_SYNC_PUBLIC=1 PARTNER_SYNC_SPORT=table_tennis bun run cron:start
# or one-shot all cron jobs including partner when PARTNER_SYNC=1:
PARTNER_SYNC=1 PARTNER_SYNC_PUBLIC=1 bun run cron:once
```

| Env | Default | Meaning |
|-----|---------|---------|
| `PARTNER_SYNC` | off | Set `1` to register partner inventory job |
| `PARTNER_SYNC_SPORT` | `table_tennis` | Stream-list sport filter |
| `PARTNER_SYNC_CRON_SCHEDULE` | `*/1 * * * *` | Bun.cron expression (min 1m) |
| `PARTNER_SYNC_PUBLIC` | off | Dummy credentials for public inventory only |
| `PARTNER_SYNC_ENRICH_BOOKED` | off | Soft Statscore name match |

| Capability | Status |
|------------|--------|
| Inventory (`stream-list-v2`) | ✅ |
| New event detection → `partner_events` | ✅ |
| Soft Statscore name → `client_event_id` | ✅ optional `--enrich-booked` |
| Markets / lines / American odds tables | ❌ not in live feeds yet |
| placeOrder POST | ❌ response parser only |
| Merge into Kalshi `liquidity:ground` | ❌ deferred until priced markets |

Code: `src/partner/sync.ts` · CLI `partner:sync`.  
Do **not** invent a full sports/leagues/markets/odds schema until a price wire is captured.

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
