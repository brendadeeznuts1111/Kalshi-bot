# Fantasy402 Ultra Live partner adapter

Kalshi-bot partner surface for a **PPH / Fantasy402** dummy desk.

> **Domain ownership (Phase 1):** Sports / live products / skins live in
> [`src/domain/`](../src/domain/README.md) — **not** under this adapter.
> **Skins** (white-labels): `buckeye`, `ace`, `metallic`, `sts`, `1bv`,
> `lvaction`, `magnum`. **Fantasy402 is a legacy alias for skin `buckeye`**
> (`resolveSkinId("fantasy402")`). Buckeye offers live products
> `{ plive, ezlive }`; ACE offers `{ ultralive, ezlive, maglive }`. Sport
> coverage bindings attach to **live products**; `widget-config.ts` shims
> `listLiveProductSportBindings("plive")`. Visual map:
> [`docs/artifacts/plive-event-meta.html`](artifacts/plive-event-meta.html).

| Concern                                | Location                                  |
| -------------------------------------- | ----------------------------------------- |
| Domain matrix (sports / skins / books) | `src/domain/`                             |
| Adapter                                | `src/partner/fantasy-ultra/adapter.ts`    |
| Cookie jar                             | `src/partner/fantasy-ultra/cookie-jar.ts` |
| Parse (boundary)                       | `src/partner/fantasy-ultra/parse.ts`      |
| Types / interfaces                     | `src/partner/types.ts`                    |
| Env profile                            | `src/partner/account-profile.ts`          |
| Smoke CLI                              | `bun run partner:test-fantasy`            |

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

**Hash generation:** not reverse-engineered. Login returns the full signed live
URL; we use it as-is.

## What works today

| Method                   | Status                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| `login()`                | ✅ Ultra Live URLs + optional warm                                              |
| `warmSession()`          | ✅ GET DESKTOP widget                                                           |
| `fetchSports()`          | ✅ Get_SportsLeagues                                                            |
| `fetchEvents({ sport })` | ✅ stream-list-v2 (coverage rows)                                               |
| `renewToken()`           | ✅ updates in-memory Bearer from `code`                                         |
| `fetchLimits`            | ⏳ stub                                                                         |
| `placeOrder`             | ✅ dry-run always; live POST only when `FANTASY402_PLACE_BET_URL` / HAR map set |

## What is **not** odds (critical — re-verified live)

The Ultra UI shows Over/Under, prices (−115), and max bet. That does **not**
mean `stream-list-v2` carries those fields.

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

| Claim (from HTML inference)                             | Live JSON fact                             |
| ------------------------------------------------------- | ------------------------------------------ |
| Root `events[]` with `markets[]` / `lines[]` / `odds[]` | **Absent**                                 |
| `homeTeam` / `awayTeam` / `startTime`                   | **Absent** (uses `competitiors.home/away`) |
| `price` / American odds                                 | **Absent**                                 |
| `limit.maxStake`                                        | **Absent**                                 |

Deep key scan for odds/market/line/price: **0 pricing hits** (only sport bucket
name `american_football`).

So:

- `fetchEvents()` → coverage catalog only
- `fetchMarkets()` → Pandora coefficient store (ML); **throws** when store empty
  (stream-list never prices)
- `inspectStreamCapabilities()` / CLI prints the capability probe

### Statscore `booked-events` (integrated — still not prices)

```text
GET https://api.statscore.com/v2/booked-events
  ?client_id=311&product=livescorepro&events_details=yes
  &client_event_id=19690946
Referer: https://plive.sportswidgets.pro/
```

| Fact                               | Live result                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| HTTP                               | 200 for valid `client_event_id`                                                         |
| Shape                              | `api.data.booked_events[]`                                                              |
| Fields                             | id, client_event_id, name, sport__, competition__, start_date, status_*, **bet_status** |
| American `price` / markets / lines | **Absent**                                                                              |
| `product=odds` / `liveodds`        | **400** “The selected product is invalid” for client_id=311                             |

Adapter methods:

| Method                               | Behavior                                 |
| ------------------------------------ | ---------------------------------------- |
| `fetchBookedEvent(clientEventId)`    | Metadata row (or null)                   |
| `listBookedEvents({ sport, limit })` | First page of booked events              |
| `fetchOdds(clientEventId)`           | **Throws** until payload has real prices |

### ID map (do not conflate)

| ID                | Source                              | Example use                                       |
| ----------------- | ----------------------------------- | ------------------------------------------------- |
| `stream_id`       | stream-list-v2                      | Video / stream inventory (`InventoryEventRef`)    |
| `feed_id`         | stream-list-v2                      | Often 0 or large int — not always client_event_id |
| `client_event_id` / `eventId` | Statscore / widget `#!/event/…` / ticket | Odds + place-bet (`OddsEventRef`)        |
| `statscore id`    | booked_events[].id                  | Internal Statscore event id                       |
| `ls_id`           | get_pushes (when path known)        | Live score pushes                                 |

**Two planes** (code: [`src/domain/odds-selection.ts`](../src/domain/odds-selection.ts)):

```text
Inventory  stream_id  ·············  (join later)  ········  Odds eventId
                                                              │
                                                    periodId + marketId + key
                                                    (OddsSelection)
```

| Proven `marketId` | Label |
| ----------------- | ----- |
| `3` | moneyline |
| `5` | total (approx) |
| `6` | spread (approx) |

Concrete ticket leg (Darin vs Plachy → Plachy ML):

| Field | Value | Meaning |
| ----- | ----- | ------- |
| `eventId` | `196878741` | That match (`#!/event/196878741`) |
| `periodId` | `m` | Full match |
| `marketId` | `3` | Moneyline |
| `key` | `2` | Away / team2 (Plachy) |

```ts
import { describeSelection, EXAMPLE_DARIN_PLACHY_SELECTION } from '../src/domain/index.ts';
describeSelection(EXAMPLE_DARIN_PLACHY_SELECTION);
// event=196878741 period=match market=moneyline side=2
```

DOM `set-to-max-{eventId}-m-{n}` is **not** a full selection (trailing `n` is
ambiguous). Ticket / coefficient coords are SSOT.

### Bet ticket wire (captured place/open response)

```json
{
  "betGroups": [
    {
      "betGroupId": 307200153,
      "ticketNumber": 1036636660,
      "finalOdds": 1.8928569555282593,
      "risk": 68,
      "toWin": 60.71,
      "currency": "USD",
      "componentBets": [
        {
          "betId": 335749942,
          "eventId": 196878741,
          "periodId": "m",
          "marketId": "3",
          "key": "2",
          "team1": "Kyryl Darin",
          "team2": "Jiri Plachy",
          "finalOdds": 1.8928569555282593
        }
      ]
    }
  ],
  "e": 0,
  "d": ""
}
```

| Field                                       | Meaning                           |
| ------------------------------------------- | --------------------------------- |
| `finalOdds`                                 | **Decimal** (~1.89), not American |
| `risk` / `toWin`                            | Stake / profit                    |
| `eventId` + `marketId` + `key` + `periodId` | Selection coordinates             |
| `e`                                         | 0 = ok                            |

| API                                                       | Role                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `parseBetGroupsResponse` / `executionResultFromBetGroups` | Boundary parse                                                       |
| `interpretBetTicketResponse(wire)`                        | Offline → `PartnerExecutionResult`                                   |
| `partner:placebet-har`                                    | Chrome HAR → `place-bet-map.json` (URL + body keys)                  |
| `placeOrder`                                              | Dry-run default; live POST when map/env URL set (never invents path) |

```bash
# 1. Chrome DevTools → Network → place a tiny bet → Save all as HAR with content
bun run partner:placebet-har -- --har=~/Downloads/fantasy.har
# 2. Review research/tickets/place-bet-map.json
export FANTASY402_PLACE_BET_URL='…'   # only the observed URL
# 3. Optional: ingest response bodies from the same HAR
bun run partner:placebet-har -- --har=… --ingest --out-id=out-SPEN-1
```

### Where pre-bet line prices still hide

1. XHR/WS **before** accept that returns board lines
2. Pandora after streamToken
3. Manager getGames / lines

Do **not** merge stream-list or Statscore livescorepro into Kalshi
`match_liquidity` as “odds”.

## Credentials (never commit)

**Preferred:** store once in Proton Pass custom item `Kalshi Bot` /
`Fantasy402`, then inject via `pass-cli run` (see
[`PROTONPASS.md`](PROTONPASS.md) · `partner:vault:provision`).

```bash
# One-time provision (export values only in this shell; never commit)
export FANTASY402_BEARER_TOKEN='…'   # browser JWT (short-lived; renew often)
export FANTASY402_CUSTOMER_ID='…'
export FANTASY402_AGENT_ID='…'
export FANTASY402_PASSWORD='…'
bun run partner:vault:provision -- --apply
# Merge pass:// lines from env-protonpass.template into .env.protonpass

# Runtime — secrets stay in Pass
bun run protonpass:run -- bun run partner:test-fantasy
```

Shell export path (dev only):

```bash
export FANTASY402_BEARER_TOKEN='…'
export FANTASY402_CUSTOMER_ID='…'
export FANTASY402_AGENT_ID='…'
export FANTASY402_PASSWORD='…'
# optional — example host; omit to use SKINS-derived Ultra-mapper default
# (requireDefaultUrlForUltraMapper / defaultUrlForSkin)
export PARTNER_DOMAIN='https://BOOK.example'   # must be a SKINS[].hosts URL → SkinId
export FANTASY402_SKIN=2
export FANTASY402_CURRENCY=USD
```

```bash
bun run partner:test-fantasy
bun run partner:test-fantasy -- --sport=tennis --limit=5 --renew
bun run partner:watch-events -- --once --sport=table_tennis --json
bun run partner:watch-events -- --loop --sport=table_tennis --interval-ms=30000
bun test tests/partner/fantasy-ultra.test.ts tests/partner/skin-events-store.test.ts
```

## Detect new table tennis events

**Primary feed:** `GET https://api-gs.player-us.xyz/stream-list-v2/?tv=usa`  
**Bucket:** `sports.table_tennis.events` — **not** `sports.tennis` (court
tennis).

| Bucket         | Live sample | `event.sport` |
| -------------- | ----------- | ------------- |
| `tennis`       | ~45         | Tennis        |
| `table_tennis` | ~33         | Table Tennis  |

`skin_events` table (created with event-store schema) stores
**Buckeye-scoped** Fantasy402 stream inventory. One row per `stream_id` covers
**both** PLive and EZLive capacity surfaces (shared Plive SportsWidgets shell)
until a separate EZ feed is proven.

| Column                       | Source                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `partner` + `stream_id`      | UNIQUE key (detection key; partner=`fantasy402`)                                    |
| `skin_id` / `book_id`        | stamped `buckeye` / `fantasy402`                                                    |
| `inventory_live_product`     | feed owner shell = `plive` (ezlive reuses)                                          |
| sport / league / home / away | stream-list (`competitiors` typo upstream); sport normalized to SportId when mapped |
| `client_event_id` / `ls_id`  | nullable until mapping exists                                                       |

```bash
# one-shot (inventory is public — dummy env is fine)
# Inventory is public (no Fantasy402 env required). Optional login env warms session.
bun run partner:watch-events -- --once --sport=table_tennis --json
bun run partner:watch-events -- --once --sport=all --json
# defaults: --skin=buckeye --book=fantasy402 (other skins rejected)

# long poll every 30s (default)
bun run partner:watch-events -- --loop --sport=table_tennis --interval-ms=30000
```

New rows print as `+ table_tennis · … · skin=buckeye book=fantasy402`. Optional
Telegram: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.

```text
stream-list-v2  ──every 30s──▶  new stream_id?  ──▶  skin_events (buckeye) + notify
                                      │                 covers: plive + ezlive
                                      ▼ (optional, needs real auth)
                              get_pushes / booked-events / PlaceBet
```

### get_pushes (stats — not for discovery)

```
https://events-d.pc.statscore.com/get_pushes/{stream_id}?messageId=…&auth=…&poll=true
```

Live probe: **403 Forbidden** without a valid session `auth`. Use stream-list
for detection only.

**Not auto-filled:** `client_event_id` / odds — stream-list has no prices;
enrich later.

## Widget runtime config (HTML source)

| Setting                             | Value                        | Implication                                     |
| ----------------------------------- | ---------------------------- | ----------------------------------------------- |
| `sportOrder`                        | `[214, 1, 2, 4, 220]`        | UI only; 214 = favorites                        |
| Table tennis widget id              | **220**                      | Sidebar                                         |
| Table tennis API / ticket `sportId` | **93**                       | betGroups, Get_SportsLeagues                    |
| stream-list bucket                  | `table_tennis`               | Detection                                       |
| `customWebSocketUrl`                | `wss://pandora.ganchrow.com` | Live odds (message format **not** captured yet) |
| `oddsFormat`                        | `american`                   | Display/wire preference                         |
| `roundUSOddsDown`                   | `true`                       | Use `roundUsOddsDown` / `normalizeOdds`         |
| `oddsDecimalPlaces`                 | `3`                          | Truncate decimals                               |
| `liveStreamLastWagerToleranceSec`   | `86400`                      | Stream UI soft gate (not data sync)             |

```ts
import {
  fantasySportByApiId,
  normalizeOdds,
  FANTASY_WIDGET_CONFIG,
} from './src/partner/index.ts';
fantasySportByApiId(93); // table_tennis, widget 220
normalizeOdds(1.8928, 'decimal'); // dual american + truncated decimal
// WS: FANTASY_WIDGET_CONFIG.customWebSocketUrl — connect after capturing message schema
```

`bun run partner:registry -- --seed` also seeds `provider_sport_mappings`.

### Pandora Socket.IO (live odds transport)

```text
wss://pandora.ganchrow.com/socket.io/?EIO=4&transport=websocket
```

| Handshake (live-probed)   | Meaning               |
| ------------------------- | --------------------- |
| `← 0{sid,pingInterval,…}` | Engine.IO open        |
| `→ 40`                    | Socket.IO connect `/` |
| `← 40{sid}`               | namespace connected   |
| `← 2` / `→ 3`             | ping / pong           |

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

Large payloads arrive as Socket.IO binary attachments (`451-` + gzip/base64
body).  
Decode: `decodePandoraAttachment` → `extractCoefficientLines` (decimal +
American via `normalizeOdds`). Diffs use JSON-patch ops (`isDiff: true`).

**Book path (wired):** `onCoefficients` → `CoefficientStore` → `fetchMarkets()`
/ `fetchOdds(clientEventId)` (match ML `marketType=3`).  
Inventory sync sets `pricedOdds: true` when the store has lines. Still **no**
`match_liquidity` merge.

```bash
bun run partner:pandora-probe -- --plive --event-ids=174125551 --seconds=20
```

Code: `PandoraSocket` · `coefficients.ts` · `coefficient-store.ts` ·
`buildPliveSubscribeSequence` · `bun run partner:webview-ws-capture`.

## Domain architecture (five layers)

Partner → Communication → Accounts/Outs → Assets → Finance.

**Full map + maturity:** [`PARTNER-DOMAIN.md`](PARTNER-DOMAIN.md) ·
`bun run partner:domain`

## Liquidity sources map (partners / outs / providers)

| Entity                    | Table / type                                            | Role                                                                             |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Partner**               | `partners`                                              | Financial owner (profit split, commission)                                       |
| **Account (out)**         | `betting_accounts`                                      | Place to bet: provider + limits + `env_prefix` for secrets                       |
| **Skin** (white-label)    | `src/domain/skins.ts`                                   | `buckeye`, `ace`, `metallic`, `sts`, `1bv`, `lvaction`, `magnum`                 |
| **Live product**          | `src/domain/live-products.ts` + capacity `meta.skins[]` | `plive` / `ezlive` / `ultralive` / `maglive` (`dark` capacity-only)              |
| **Provider** (legacy env) | adapter id (`fantasy402`, `kalshi`)                     | Still used on outs / env; `fantasy402` is BookId + mapper token → skin `buckeye` |
| **Sports map**            | `src/domain/` + `provider_sport_mappings` seed          | Live-product keys primary; optional legacy `fantasy402` dual-write               |
| **Stream inventory**      | `skin_events`                                        | Detected events (not priced book)                                                |
| **Desk liquidity**        | `match_liquidity`                                       | Kalshi-priced gates (`tradable` / `liq_ok`)                                      |

### Unknown host discovery

Works for **any** host. Mapped desks come from `SKINS[].hosts` (not a hard-coded
book list).

```bash
bun run partner:host-discover -- --url=https://BOOK.example
# → skin unknown|suggested, stores public HTML/asset URLs under docs/artifacts/host-discover/<host>-urls.json

bun run partner:host-discover -- --url=https://BOOK.example --har=./session.har
# → merges session URLs into inventory only (no Ultra→skin scoring)

bun run partner:host-discover -- --all
# → every apex host in SKINS[].hosts

bun run partner:host-discover -- --url=https://BOOK.example --compare --json
# → optional target + all mapped apex hosts
```

- Suggests `SkinId` (+ `adapterId` from that skin’s mapper) — **does not** edit
  `SKINS[].hosts`
- **Weighted evidence** (`capped-category-v1`): definitive · endpoint · asset ·
  infrastructure · meta  
  — profiles live on `SKINS[].fingerprints` (buckeye / metallic first). Use
  `--weigh` for category breakdown.
- Decision thresholds: ≥0.90 map (after confirm) · 0.70–0.89 HAR/review ·
  0.40–0.69 gather more · &lt;0.40 weak
- Not Ultra stack markers (`getUltraLiveURL`, player-us) — those stay on the
  fantasy-ultra adapter path
- Session HAR: URL inventory only (feeds path/asset extraction, not Ultra→skin
  scoring)
- Mapped host → definitive score 1.0 (`already_mapped`)
- URL inventory: `docs/artifacts/host-discover/<host>-urls.json`
- Code: `src/partner/host-discover.ts` · `src/partner/host-weighted-score.ts` ·
  `tools/partner-host-discover.ts`

### Out identity boundary (host → skin → live products → adapter)

On `seedFantasy402FromEnv` / `upsertBettingAccount` (`partner/out-identity.ts`):

1. Resolve host via `getSkinByHost(url)` → white-label `skinId` (unknown host →
   reject; add to `SKINS[].hosts`)
2. Parse capacity from `meta.liveProducts` (dual-read legacy `meta.skins`)
3. Assert capacity ⊆ skin `offeredLiveProducts` (plus legacy `dark` / numeric
   Ultra wire)
4. Derive `AdapterBinding`: `adapterId` (`fantasy-ultra` | `kalshi` |
   `unmapped`) + `mapperKind` + `bookEnvToken`
5. Stamp `skinId`, `mapper`, `liveProducts` + legacy `skins` mirror,
   `defaultLiveProduct`
6. `getPartnerAdapter` selects Fantasy Ultra when
   `adapterId === "fantasy-ultra"`

Env alias: `FANTASY402_LIVE_PRODUCTS_JSON` (same shape as
`FANTASY402_SKINS_JSON`).

### Sports + leagues inventory

```bash
bun run partner:sports                 # live stream-list sports (non-zero events)
bun run partner:sports -- --all        # include empty buckets
bun run partner:sports -- --leagues=table_tennis
bun run partner:sports -- --leagues=all --json
bun run partner:sports -- --map        # offline static map
bun run partner:sports -- --seed       # refresh provider_sport_mappings
bun run partner:sync -- --sport=all    # upsert all buckets into skin_events
```

- **Primary** (★): soccer, tennis, basketball, table_tennis — confirmed
  `apiSportId` + widget id.
- **Mapped**: all known stream-list buckets (cricket, ice_hockey, …) — league
  names from events.
- **Not yet**: full Get_SportsLeagues catalog / Pandora `live.leagues` decode
  (needs auth / binary parse).

### Out × skin matrix (PPH)

Out = account (vault credentials + shared `workingBalance`).  
Skin = live provider surface — same credentials, different limits / often
different lines.

| Layer              | Naming                                           | Example                                   |
| ------------------ | ------------------------------------------------ | ----------------------------------------- |
| Out                | `out-{PARTNER}-{n}`                              | `out-SPEN-1`                              |
| Skin (white-label) | `buckeye` / `ace` / … (env may say `fantasy402`) | `buckeye`                                 |
| Live product       | coverage + login wire                            | `plive`, `ezlive`, `ultralive`, `maglive` |
| Liquidity key      | `{outId}@{liveProduct}`                          | `out-SPEN-1@ezlive`                       |
| Vault              | credentials **per out**                          | `vault-out-SPEN-1`                        |

```json
{
  "vaultId": "vault-out-SPEN-1",
  "partnerCode": "SPEN",
  "workingBalance": 5000,
  "skins": [
    { "name": "ezlive", "perBetMax": 500, "maxWin": 2500, "active": true },
    { "name": "dark", "perBetMax": 1000, "maxWin": 5000, "active": true }
  ]
}
```

**Capacity** = Σ active skins' `perBetMax` across active outs (fallback:
single-skin `max_stake`).  
Concentration groups exposure by **out** (across skins). Execution: pick out →
best skin ≥ stake → adapter `{ skin }`.  
That is **not** market `tradable` — only stake capacity until a priced line
exists.

```bash
# Single-skin seed
export FANTASY402_CUSTOMER_ID=BB55113 FANTASY402_MAX_STAKE=1000 FANTASY402_MAX_WIN=5000
bun run partner:registry -- --seed --json

# Multi-skin out
export FANTASY402_PARTNER_CODE=SPEN FANTASY402_ACCOUNT_ID=out-SPEN-1
export FANTASY402_WORKING_BALANCE=5000
export FANTASY402_SKINS_JSON='[{"name":"ezlive","perBetMax":500,"maxWin":2500},{"name":"dark","perBetMax":1000,"maxWin":5000}]'
bun run partner:registry -- --seed
bun run partner:capacity
bun run partner:capacity -- --stake=800 --json
```

Code: `src/partner/skins.ts` · `computeProviderCapacity` ·
`listEligibleOutSkinPairs` · `concentrationByOut` ·
`getFantasySessionAdapter(profile, { skin })`.

| Ready                                 | Not ready                              |
| ------------------------------------- | -------------------------------------- |
| Registry + capacity rollup (out×skin) | Partner markets in `liquidity:ground`  |
| Fantasy402 inventory sync             | Full seat-capital concentration scorer |
| Ticket response parse                 | placeOrder POST                        |

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

| Env                          | Default        | Meaning                                     |
| ---------------------------- | -------------- | ------------------------------------------- |
| `PARTNER_SYNC`               | off            | Set `1` to register partner inventory job   |
| `PARTNER_SYNC_SPORT`         | `table_tennis` | Stream-list sport filter                    |
| `PARTNER_SYNC_CRON_SCHEDULE` | `*/1 * * * *`  | Bun.cron expression (min 1m)                |
| `PARTNER_SYNC_PUBLIC`        | off            | Dummy credentials for public inventory only |
| `PARTNER_SYNC_ENRICH_BOOKED` | off            | Soft Statscore name match                   |

| Capability                              | Status                           |
| --------------------------------------- | -------------------------------- |
| Inventory (`stream-list-v2`)            | ✅                               |
| New event detection → `skin_events`  | ✅                               |
| Soft Statscore name → `client_event_id` | ✅ optional `--enrich-booked`    |
| Markets / lines / American odds tables  | ❌ not in live feeds yet         |
| placeOrder POST                         | ❌ response parser only          |
| Merge into Kalshi `liquidity:ground`    | ❌ deferred until priced markets |

Code: `src/partner/sync.ts` · CLI `partner:sync`.  
Do **not** invent a full sports/leagues/markets/odds schema until a price wire
is captured.

## Security

- Tokens/passwords must not land in git or fixtures.
- Prefer Proton Pass inject (`env.template` keys).
- Rotate any token pasted into chat or shell history.
- `renewToken` extends short JWT windows (~minutes); call before long loops.

## Still open (need capture)

| Missing                | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| PlaceBet / ticket POST | Place a tiny bet in the widget; capture URL + body           |
| Real stake limits      | Endpoint may sit under `betFactoryV2` or Manager APIs        |
| Pandora WebSocket      | `wss://pandora.ganchrow.com/socket.io/` + streamToken.php    |
| Cloudflare cookies     | Optional `cf_clearance` / `__cf_bm` if WAF blocks automation |
