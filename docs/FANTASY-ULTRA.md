# Fantasy402 Ultra Live + plive/ezlive inventory

Book adapter and coverage inventory for a **PPH / Fantasy402** desk (skin
`buckeye`). This is **not** seat-partner capital.

> **Planes:**
> - **Domain** — sports / live products / skins / competitions in
>   [`src/domain/`](../src/domain/README.md)
> - **Inventory** — stream-list → `skin_events` + `inventory_leagues` in
>   [`src/inventory/`](../src/inventory/) · CLIs `domain:sports` ·
>   `inventory:sync` · `inventory:watch` · `inventory:leagues` · playbook
>   [`INVENTORY.md`](INVENTORY.md) (**ezlive** = shared plive shell; no dual
>   event rows; seat capacity is separate)
> - **Seat** — outs / capacity / execution still under `src/partner/`
>
> **Skins** (white-labels): `buckeye`, `ace`, `metallic`, `sts`, `1bv`,
> `lvaction`, `magnum`. **Fantasy402 is a legacy alias for skin `buckeye`**
> (`resolveSkinId("fantasy402")`). Buckeye offers live products
> `{ plive, ezlive }` **and shares one SportsWidgets stream-list** for
> inventory; ACE offers `{ ultralive, ezlive, maglive }` (no Buckeye-style
> stream harvest here). Sport coverage bindings attach to **live products**;
> `widget-config.ts` shims `listLiveProductSportBindings("plive")`. Visual map:
> [`docs/artifacts/plive-event-meta.html`](artifacts/plive-event-meta.html).
> Operator checklist: [`INVENTORY.md`](INVENTORY.md) § Operator checklist.
> **Shell sports rules** (settlement / void / action — weight lines & movement):
> [`PLIVE-EZLIVE-SPORTS-RULES.md`](PLIVE-EZLIVE-SPORTS-RULES.md) · sport-wide
> **edge patterns** (market/line/sport families):
> [`EDGE-PATTERNS.md`](EDGE-PATTERNS.md) · `src/settlement/` ·
> `bun live-tracker.ts patterns`.

| Concern                                | Location                                  |
| -------------------------------------- | ----------------------------------------- |
| Domain matrix (sports / skins / books) | `src/domain/`                             |
| Inventory sync / stream sports         | `src/inventory/`                          |
| Shell sports rules (plive/ezlive)      | `docs/PLIVE-EZLIVE-SPORTS-RULES.md`       |
| Book adapter                           | `src/partner/fantasy-ultra/adapter.ts`    |
| Cookie jar                             | `src/partner/fantasy-ultra/cookie-jar.ts` |
| Parse (boundary)                       | `src/partner/fantasy-ultra/parse.ts`      |
| Adapter DTO types                      | `src/partner/types.ts`                    |
| Out env profile                        | `src/partner/account-profile.ts`          |
| Smoke CLI                              | `bun run partner:test-fantasy`            |
| Widget domain harvest                  | `bun run domain:widget-extract`           |
| Session plane probe                    | `bun run inventory:session-probe`         |

## Widget domain harvest (sports · markets · leagues)

| Data | Source | Notes |
| ---- | ------ | ----- |
| `MARKET_*` labels | Shell HTML `LANGUAGES.texts` | Static, ~400+ keys |
| Rules sport icons | Shell HTML rules `icon` | Maps → `SportId` |
| Live sports + market flags | Pandora `live.sports` | Dynamic catalog |
| Leagues | Pandora `live.leagues` | **Not** static in HTML |
| Wager / market types | Pandora `live.wagerTypes` | Name + short codes |

```bash
bun run domain:widget-extract                 # shell + Pandora (~12s)
bun run domain:widget-extract -- --html-only
bun run domain:widget-extract -- --write      # research/cache/widget-domain-snapshot.json
bun run domain:widget-extract -- --json
```

Code: `src/domain/widget-domain-extract.ts`. No gsid. Gaps print vs domain
`SPORTS`; league promote remains `inventory:leagues --promote`.

**Integrate snapshot into COMPETITIONS** (limited + junk filter — do not dump 3898):

```bash
bun run domain:pandora -- --report
bun run domain:pandora -- --promote --limit=50
bun run domain:pandora -- --promote --apply --limit=20 --sport=soccer
bun run domain:pandora -- --markets
```

`providerMappings.pandora.leagueId` links feed league ids when applied.
Code: `src/domain/pandora-domain-integrate.ts`.

## Session planes (HAR 2026-08-10 + live probe)

| Plane | Endpoint | Auth |
| ----- | -------- | ---- |
| **Inventory (public)** | `GET api-gs.player-us.xyz/stream-list-v2/?tv=usa` | none |
| **Shell handoff** | `getUltraLiveURL` → signed `/live/?customerId&hash` → `gsid` | seat body-auth then session |
| **Session-gated** | `GET plive…/betFactoryV2/api/streamToken.php` + `x-gsid` | bound gsid (403 without) |
| **Prices** | `wss://pandora.ganchrow.com/socket.io/` | streamToken JWT after gsid |

Operator check (never logs full gsid/JWT; do not commit `PLIVE_GSID`):

```bash
bun run inventory:session-probe
bun run inventory:session-probe -- --json
# optional bound session from plive /live/?gsid=… :
# PLIVE_GSID=… bun run inventory:session-probe
```

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
| `fetchInventory({ sport })` | ✅ stream-list-v2 (coverage catalog)                                            |
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

- `fetchInventory()` → coverage catalog only
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
| `fetchBookedEvent(oddsEventId)`      | Metadata row (or null)                   |
| `listBookedEvents({ sport, limit })` | First page of booked events              |
| `fetchOdds(oddsEventId)`             | **Throws** until payload has real prices |

### ID map (do not conflate)

**Full glossary (SSOT):** [`SEAT-OPS.md` § ID glossary](SEAT-OPS.md#id-glossary-ssot).

Wire → interior at parse (JSON / query only — never interior field names):

| Wire (JSON / URL) | Interior | Notes |
| ----------------- | -------- | ----- |
| `stream_id` | `inventoryId` | stream-list-v2 → `InventoryEvent` / `skin_events.inventory_id` |
| `client_event_id` | `oddsEventId` | Statscore / widget / ticket → `OddsEventRef` / `skin_events.odds_event_id` |
| `feed_id` | *(wire-only)* | Often 0 or large int — **not** odds event id; stored as opaque `feedId` |
| `donbest_id` | *(wire-only)* | Opaque upstream string; not an interior brand |
| `ls_id` | *(wire-only)* | get_pushes path when known; nullable column, not a brand |
| booked_events[].id | `statscoreId` | Statscore internal event id |

**Three planes** (code: [`src/domain/odds-selection.ts`](../src/domain/odds-selection.ts)):

```text
Wire       stream_id / client_event_id   (provider JSON / query only)
Inventory  inventoryId                   (skin_events.inventory_id)
Odds       oddsEventId + OddsLine coords (Pandora)
Ticket     TicketLeg.eventId + …         (componentBet)
```

Odds and ticket often share the same numeric `eventId`, but **types and field
names stay separate** — bridge only via `ticketLegFromOddsLine` /
`oddsLineFromTicketLeg`.

| Proven market id | Label |
| ---------------- | ----- |
| `3` | moneyline |
| `5` | total (approx) |
| `6` | spread (approx) |

Concrete example (Darin vs Plachy → Plachy ML):

```ts
import {
  describeOddsLine,
  describeTicketLeg,
  EXAMPLE_DARIN_PLACHY_ODDS_LINE,
  EXAMPLE_DARIN_PLACHY_TICKET_LEG,
} from '../src/domain/index.ts';

describeOddsLine(EXAMPLE_DARIN_PLACHY_ODDS_LINE);
// odds event=196878741 period=match market=moneyline selection=2

describeTicketLeg(EXAMPLE_DARIN_PLACHY_TICKET_LEG);
// ticket event=196878741 period=match market=moneyline key=2
```

DOM `set-to-max-{eventId}-m-{n}` is **not** a `TicketLeg` or `OddsLine`.

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
export DESK_DOMAIN='https://BOOK.example'   # must be a SKINS[].hosts URL → SkinId
export FANTASY402_LIVE_PRODUCT=2
export FANTASY402_CURRENCY=USD
```

```bash
bun run partner:test-fantasy
bun run partner:test-fantasy -- --sport=tennis --limit=5 --renew
bun run inventory:watch -- --once --sport=all --dry-run --json   # plan only; covers plive+ezlive
bun run inventory:watch -- --once --sport=table_tennis --json
bun run inventory:watch -- --loop --sport=all --interval-ms=30000
bun run inventory:leagues -- --unmapped
bun test tests/partner/fantasy-ultra.test.ts tests/inventory/
```

Full-board + leagues + promote + ezlive capacity:
[`INVENTORY.md`](INVENTORY.md).

## Detect new table tennis events

**Primary feed:** `GET https://api-gs.player-us.xyz/stream-list-v2/?tv=usa`  
**Bucket:** `sports.table_tennis.events` — **not** `sports.tennis` (court
tennis). Prefer `--sport=all` for coverage; TT is one primary bucket.

| Bucket         | Live sample | `event.sport` |
| -------------- | ----------- | ------------- |
| `tennis`       | ~45         | Tennis        |
| `table_tennis` | ~33         | Table Tennis  |

`skin_events` table (created with event-store schema) stores
**Buckeye-scoped** Fantasy402 inventory. One row per `(book_id, inventory_id)`
covers **both** PLive and EZLive capacity surfaces (shared Plive SportsWidgets
shell — **do not dual-write** ezlive rows). Durable league dimension:
`inventory_leagues` (see playbook). At parse, wire JSON `stream_id` →
`inventory_id` (interior never keeps `stream_id` as a field name).

| Column                       | Source                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `book_id` + `inventory_id`   | UNIQUE key (detection key; book=`fantasy402`; inventory from wire `stream_id`)      |
| `partner`                    | **deprecated** mirror of `book_id` (not a seat partner CODE; stop reading in new paths) |
| `skin_id` / `book_id`        | stamped `buckeye` / `fantasy402`                                                    |
| `inventory_live_product`     | feed owner shell = `plive` (ezlive reuses)                                          |
| `competition_id`             | seeded CompetitionId from sport + league (null when unmapped)                       |
| sport / league / home / away | stream-list (`competitiors` typo upstream); sport normalized to SportId when mapped |
| `odds_event_id`              | nullable until mapping exists (wire `client_event_id` → interior `oddsEventId`)     |
| `feed_id` / `ls_id` / `donbest_id` | **wire-only** opaque columns — not odds/inventory brands                      |

```bash
# one-shot (inventory is public — dummy env is fine)
# Inventory is public (no Fantasy402 env required). Optional login env warms session.
bun run inventory:watch -- --once --sport=all --dry-run --json
bun run inventory:watch -- --once --sport=all --json
bun run inventory:watch -- --once --sport=table_tennis --json
# defaults: --skin=buckeye --book=fantasy402 (other skins rejected)

# long poll every 30s — full board for coverage
bun run inventory:watch -- --loop --sport=all --interval-ms=30000

# durable leagues + promote (operator)
bun run inventory:leagues
bun run inventory:leagues -- --promote
```

New rows print as `+ table_tennis · … · skin=buckeye book=fantasy402` (and
`+L` for new leagues). Optional Telegram: `TELEGRAM_BOT_TOKEN` +
`TELEGRAM_CHAT_ID`.

```text
stream-list-v2  ──every 30s──▶  new inventory_id?  ──▶  skin_events (buckeye) + notify
                                      │                 + inventory_leagues
                                      │                 covers: plive + ezlive
                                      ▼ (optional, needs real auth)
                              get_pushes / booked-events / PlaceBet
                              (ezlive = capacity/session wire, same catalog)
```

### get_pushes (stats — not for discovery)

Wire URL path still uses the provider’s `{stream_id}` segment (not an interior
field). Prefer the parsed `inventoryId` in app code when composing calls.

```
https://events-d.pc.statscore.com/get_pushes/{stream_id}?messageId=…&auth=…&poll=true
```

Live probe: **403 Forbidden** without a valid session `auth`. Use stream-list
for detection only.

**Not auto-filled:** `odds_event_id` / odds — stream-list has no prices;
enrich later (wire `client_event_id` soft-matched via `--enrich-booked`).

## Widget runtime config (HTML source)

| Setting                             | Value                        | Implication                                     |
| ----------------------------------- | ---------------------------- | ----------------------------------------------- |
| `sportOrder`                        | `[214, 1, 2, 4, 220]`        | UI only; 214 = favorites                        |
| Table tennis widget id              | **220**                      | Sidebar                                         |
| Table tennis API / ticket `sportId` | **93**                       | betGroups `componentBets[].sportId`, mainapp `isTableTennis` |
| Tennis ticket / feed                | **8**                        | mainapp `isTennis`                              |
| Soccer ticket / feed                | **5**                        | mainapp `isSoccer` (also shells 214/220/221)    |
| Golf / racing                       | **7** / **9**                | mainapp `isGolf` / `isRacing`                   |
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
wss://pandora.ganchrow.com/socket.io/?EIO=4&transport=websocket   # plive desk (default)
wss://spandora.ganchrow.com/socket.io/?EIO=4&transport=websocket  # public sportswidgets.pro
```

Same Engine.IO / Socket.IO protocol, same `LINE_SET` token
(`U0VWU1NWUkJSMFU9`), same JSON-patch diffs. Host only differs by edge.

| Host | Shell | Flag |
| ---- | ----- | ---- |
| `pandora` | plive.sportswidgets.pro | default |
| `spandora` | sportswidgets.pro | `--spandora` / `--host=spandora` |

**Feed sport 93 = table tennis** (`isTableTennis(e){return Number(e)===93}`).
Tennis on the live board is feed id **8** (ticket `apiSportId` map still
uses legacy widget ids for some sports).

**Market type labels** (Pandora + ticket share ids):

| Id | Label | Notes |
| -- | ----- | ----- |
| 3 | moneyline | sides 1/2 |
| 5 | total | games or points by sport |
| 6 | spread / handicap | |
| 7 | total_points | TT |
| 8 | team_total | |
| 9 | correct_score_sets | |
| 16 | set_correct_score | `lineId = (p1<<16)\|p2` (BO5: 3-0…0-3) |
| 18 | game_winner | odd game # keys; o=[p1,p2] |

```bash
bun run domain:event -- --id=197501721 --spandora
bun run domain:event -- --board --spandora --sport=93 --bettable
# 90s watch: suspension intervals + vig snapshot (spandora TT)
bun run domain:event -- --id=197501721 --spandora --watch --seconds=90
```

**Vig:** `overroundFromDecimals` / `vigFromCoefficientLines` — multi-way m/16
drops ~1.0 companion legs; two-way core markets ~8–9% on live TT.

**Suspensions:** `summarizeOddsWatch` pairs `market_off`→`market_on` with
duration (median/mean). Live TT sample: short m/5 suspends ~1–5s; batch
suspend of s3/* often ~17–19s around game points.

Decode helpers: `market-decode.ts` · hosts: `pandora-hosts.ts` · watch summary
in `event-lookup.ts`.

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

### eventData board (event-level state)

Room `live.main.{token}.eventData` is the live **board index** (mainapp
`receiveEvents`), not a single-event DTO. Snapshot keys:

| Key | Meaning |
| --- | --- |
| `s` | Tree `s[sportId][countryId][leagueId][eventId]` |
| `db` | DonBest rotation id → eventId |
| `kb` | Opaque reverse index (large; not used by mainapp offer gates) |
| `x` | Per-shard betOffline flags (`handleBetOfflineUpdate`) |
| `c` / `m` / `f` / `ec` | Optional coeffs / misc / flush / updateState ids |

Each event node is a 13-slot array. Last element (index 12; mainapp `p.pop()`)
is the **dynamic** object:

| Wire | Maps to |
| ---- | ------- |
| `s` | `EVENT_STATES`: 0 bettable · 1 blocked · 2 notBettable · 3 finished |
| `ip` | isStarted |
| `il` | isLive |
| `l` | hasLines (board hasOdds proxy) |
| `n` | shard |
| `oc` | oddsCount (when present) |
| `ht` | isHalftime |

UI **off the board** (`isOTB`): finished ‖ notBettable ‖ blocked ‖ !hasOdds.  
Diff path example: `/s/8/340/14358/197502861/12/l` → `hasLines` flip.

**Odds taken off (two planes):**

1. **Market** — `eventCoefficients`: empty `o` / `selection_off` / `market_off`
2. **Event** — `eventData`: `s`→2|3 or `l`→false

`cls` on coefficient markets is **limit/price-class**, not suspend.

```bash
bun run domain:event -- --id=197488581          # eventState + book
bun run domain:event -- --id=197548901 --watch  # state + coeff transitions
bun run domain:event -- --board                 # full board OTB / by-sport
bun run domain:event -- --board --bettable --sport=8
# Market first, then optional seat (FANTASY402_*). Exit 1 only on market/profile fail
# (or session fail when --validate-session).
bun run domain:event -- --id=197488581 --validate
bun run domain:event -- --id=197488581 --validate-session --renew
```

**Validate planes:** inventory → market (Pandora OTB/lines) → profile
(blocked) → session (login/warm/cookies).  
`market_ok_session_fail` = poorly held seat, market still live.  
`market_off` = fix market/id, not password.

**Three sport-id planes** (SSOT: `src/domain/pandora-feed-sports.ts` +
`live-product-sport-bindings.ts`):

| Plane | Source | Tennis | Basketball | TT | Soccer |
| ----- | ------ | ------ | ---------- | -- | ------ |
| **feedSportId** | eventData / live.sports | **8** | **2** | **93** | **5** |
| **widgetSportId** | shell sportOrder | 2 | 4 | 220 | 1 |
| **apiSportId** | ticket / componentBet (proven) | **8** | — | **93** | **5** |
| **inventoryBucket** | stream-list-v2 | tennis | basketball | table_tennis | football |

`apiSportId` = feed number for sports proven by mainapp `isX` and/or betGroups
(TT). Basketball etc. stay feed-only until a ticket capture proves them.
**Collision:** feed shell **220** = Top Soccer; widget **220** = TT sidebar.

```ts
import { resolveSport, sportIdFromFeedSportId, FEED_SPORT } from './src/domain/index.ts';
sportIdFromFeedSportId(8);                          // 'tennis'
resolveSport({ liveProduct: 'plive', feedSportId: 2 }); // basketball (not tennis!)
resolveSport({ liveProduct: 'plive', widgetSportId: 2 }); // tennis shell
```

| Feed id | Name | SportId |
| ------- | ---- | ------- |
| 1 | Baseball | baseball |
| 2 | Basketball | basketball |
| 3 | Football | american_football |
| 4 | Hockey | ice_hockey |
| 5 | Soccer | soccer |
| 6 | Fighting | martial_arts |
| 7 | Golf | golf |
| 8 | Tennis | tennis |
| 87 | Cricket | cricket |
| 93 | Table Tennis | table_tennis |
| 114 | E-Sports | sports_channels |

**Effective state** (mainapp `calculateState`): groupProfile
`blocked.{sports,leagues,events}` forces **notBettable** even when wire `s=0`.
Decode: `scanEventDataBoard` · `parsePandoraBlocked` ·
`findEventInEventDataBoard` · `decodeEventOfferability`.

**Book path (wired):** `onCoefficients` → `CoefficientStore` → `fetchMarkets()`
/ `fetchOdds(oddsEventId)` (match ML `marketType=3`).  
Inventory sync sets `pricedOdds: true` when the store has lines. Still **no**
`match_liquidity` merge.

```bash
bun run partner:pandora-probe -- --plive --event-ids=174125551 --seconds=20
```

Code: `PandoraSocket` · `coefficients.ts` · `coefficient-store.ts` ·
`event-lookup.ts` · `buildPliveSubscribeSequence` ·
`bun run partner:webview-ws-capture`.

## Domain architecture (five layers)

Partner → Communication → Accounts/Outs → Assets → Finance.

**Full map + maturity:** [`SEAT-OPS.md`](SEAT-OPS.md) ·
`bun run ops:status`

## Liquidity sources map (partners / outs / providers)

| Entity                    | Table / type                                            | Role                                                                             |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Partner**               | `partners`                                              | Financial owner (profit split, commission)                                       |
| **Account (out)**         | `betting_accounts`                                      | Place to bet: provider + limits + `env_prefix` for secrets                       |
| **Skin** (white-label)    | `src/domain/skins.ts`                                   | `buckeye`, `ace`, `metallic`, `sts`, `1bv`, `lvaction`, `magnum`                 |
| **Live product**          | `src/domain/live-products.ts` + capacity `meta.liveProducts[]` | `plive` / `ezlive` / `ultralive` / `maglive` (`dark` capacity-only)       |
| **Adapter surface**       | `SurfaceAdapterId` (`fantasy402`, `kalshi`)             | DTO token on inventory/book rows — **not** seat `partnerId`; mapper is `MapperAdapterId` (`fantasy-ultra` …) |
| **Provider** (legacy env) | env / outs column mirror                                | Still on outs / env; `fantasy402` is BookId + mapper token → skin `buckeye` |
| **Sports map**            | `src/domain/` + `provider_sport_mappings` seed          | Live-product keys primary; optional legacy `fantasy402` dual-write               |
| **Stream inventory**      | `skin_events`                                        | Detected events (not priced book)                                                |
| **Desk liquidity**        | `match_liquidity`                                       | Kalshi-priced gates (`tradable` / `liq_ok`)                                      |

### Unknown host discovery

Works for **any** host. Mapped desks come from `SKINS[].hosts` (not a hard-coded
book list).

```bash
bun run domain:host-discover -- --url=https://BOOK.example
# → skin unknown|suggested, stores public HTML/asset URLs under docs/artifacts/host-discover/<host>-urls.json

bun run domain:host-discover -- --url=https://BOOK.example --har=./session.har
# → merges session URLs into inventory only (no Ultra→skin scoring)

bun run domain:host-discover -- --all
# → every apex host in SKINS[].hosts

bun run domain:host-discover -- --url=https://BOOK.example --compare --json
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
- Code: `src/domain/host-discover.ts` · `src/domain/host-weighted-score.ts` ·
  `tools/host-discover-cli.ts`

### Out identity boundary (host → skin → live products → adapter)

On `seedFantasy402FromEnv` / `upsertBettingAccount` (`partner/out-identity.ts`):

1. Resolve host via `getSkinByHost(url)` → white-label `skinId` (unknown host →
   reject; add to `SKINS[].hosts`)
2. Parse capacity from `meta.liveProducts` only (legacy `meta.skins` ignored)
3. Assert capacity ⊆ skin `offeredLiveProducts` (plus legacy `dark` / numeric
   Ultra wire)
4. Derive `AdapterBinding`: `adapterId` (`fantasy-ultra` | `kalshi` |
   `unmapped`) + `mapperKind` + `bookEnvToken`
5. Stamp `skinId`, `mapper`, `liveProducts`, `defaultLiveProduct` only —
   writers **drop** any legacy `meta.skins` / `defaultSkin`
6. `getPartnerAdapter` selects Fantasy Ultra when
   `adapterId === "fantasy-ultra"`

Capacity JSON: `FANTASY402_LIVE_PRODUCTS_JSON` (array of `{name,perBetMax,maxWin}`).

### Sports + leagues inventory

```bash
bun run domain:sports                 # live stream-list sports (non-zero events)
bun run domain:sports -- --all        # include empty buckets
bun run domain:sports -- --leagues=table_tennis
bun run domain:sports -- --leagues=all --json
bun run domain:sports -- --map        # offline static map
bun run domain:sports -- --seed       # refresh provider_sport_mappings
bun run domain:widget-extract         # HTML MARKET_* + Pandora sports/leagues/wagers
bun run inventory:sync -- --sport=all    # events + leagues (plive shell → ezlive cover)
bun run inventory:leagues -- --unmapped  # promote feed for COMPETITIONS
```

- **Primary** (★): soccer, tennis, basketball, table_tennis — confirmed
  `apiSportId` + widget id.
- **Mapped**: all known stream-list buckets (cricket, ice_hockey, …) — league
  names from events.
- **Not yet**: full Get_SportsLeagues catalog / Pandora `live.leagues` decode
  (needs auth / binary parse).

Playbook (full board · leagues · promote · ezlive capacity):
[`INVENTORY.md`](INVENTORY.md).

### Out × live-product capacity (PPH)

Out = account (vault credentials + shared `workingBalance`).  
Live product = capacity / Ultra wire row — same credentials, different limits /
often different lines. **Not** white-label `SkinId` (that is desk identity).

**ezlive on Buckeye:** inventory is already harvested on the plive shell
(`coversLiveProducts` includes ezlive). Adding an `ezlive` capacity row only
gates stake/session — it does **not** create a second event catalog. Recipe:
[`INVENTORY.md`](INVENTORY.md) § ezlive capacity.

| Layer              | Naming                                           | Example                                   |
| ------------------ | ------------------------------------------------ | ----------------------------------------- |
| Out                | `out-{PARTNER}-{n}`                              | `out-SPEN-1`                              |
| Skin (white-label) | `buckeye` / `ace` / … (desk host map)            | `buckeye`                                 |
| Live product       | capacity + login wire                            | `plive`, `ezlive`, `ultralive`, `maglive` |
| Liquidity key      | `{outId}@{liveProduct}`                          | `out-SPEN-1@ezlive`                       |
| Vault              | credentials **per out**                          | `vault-out-SPEN-1`                        |

```json
{
  "vaultId": "vault-out-SPEN-1",
  "partnerCode": "SPEN",
  "workingBalance": 5000,
  "liveProducts": [
    { "name": "ezlive", "perBetMax": 500, "maxWin": 2500, "active": true },
    { "name": "dark", "perBetMax": 1000, "maxWin": 5000, "active": true }
  ]
}
```

**Capacity** = Σ active live products' `perBetMax` across active outs (fallback:
single-product `max_stake`).  
Concentration groups exposure by **out** (across live products). Execution:
pick out → best live product ≥ stake → adapter.  
That is **not** market `tradable` — only stake capacity until a priced line
exists.

```bash
# Single-skin seed
export FANTASY402_CUSTOMER_ID=BB55113 FANTASY402_MAX_STAKE=1000 FANTASY402_MAX_WIN=5000
bun run partner:registry -- --seed --json

# Multi-skin out
export FANTASY402_PARTNER_CODE=SPEN FANTASY402_ACCOUNT_ID=out-SPEN-1
export FANTASY402_WORKING_BALANCE=5000
export FANTASY402_LIVE_PRODUCTS_JSON='[{"name":"ezlive","perBetMax":500,"maxWin":2500},{"name":"dark","perBetMax":1000,"maxWin":5000}]'
bun run partner:registry -- --seed
bun run partner:capacity
bun run partner:capacity -- --stake=800 --json
```

Code: `src/partner/out-capacity.ts` · `computeProviderCapacity` ·
`listEligibleOutSkinPairs` · `concentrationByOut` ·
`getFantasySessionAdapter(profile, { skin })`.

| Ready                                 | Not ready                              |
| ------------------------------------- | -------------------------------------- |
| Registry + capacity rollup (out×skin) | Partner markets in `liquidity:ground`  |
| Fantasy402 inventory sync             | Full seat-capital concentration scorer |
| Ticket response parse                 | placeOrder POST                        |

## Unified sync module (ground truth)

```bash
bun run inventory:sync -- --sport=table_tennis --once --json
bun run inventory:sync -- --sport=table_tennis --dry-run --json   # plan only, no SQLite writes
bun run inventory:sync -- --sport=table_tennis --loop --interval-ms=30000
bun run inventory:sync -- --enrich-booked --once   # soft name→odds_event_id (metadata only)
bun run inventory:sync -- --enrich-booked --enrich-scope=board
bun run inventory:sync -- --enrich-booked --enrich-scope=unlinked

# In-process cron (with other desk jobs)
INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 INVENTORY_SYNC_SPORT=all bun run cron:start
# enrich on each tick:
INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 INVENTORY_SYNC_ENRICH_BOOKED=1 bun run cron:start
```

| Env                          | Default        | Meaning                                     |
| ---------------------------- | -------------- | ------------------------------------------- |
| `INVENTORY_SYNC` / `PARTNER_SYNC` | off       | Register inventory cron job                 |
| `INVENTORY_SYNC_SPORT`       | `all`          | Stream-list sport filter                    |
| `INVENTORY_SYNC_CRON_SCHEDULE` | `*/1 * * * *` | Bun.cron expression (min 1m)              |
| `INVENTORY_SYNC_PUBLIC`      | off            | Dummy credentials for public inventory only |
| `INVENTORY_SYNC_ENRICH_BOOKED` | off          | Soft Statscore name match (scope=board)     |

| Capability                              | Status                           |
| --------------------------------------- | -------------------------------- |
| Inventory (`stream-list-v2`)            | ✅                               |
| New event detection → `skin_events`  | ✅                               |
| Soft Statscore name → `odds_event_id`   | ✅ `--enrich-booked` (board/new/unlinked) |
| Markets / lines / American odds tables  | ❌ stream-list; Pandora store optional |
| placeOrder POST                         | ❌ response parser only          |
| Merge into Kalshi `liquidity:ground`    | ❌ deferred until priced markets |

Code: `src/inventory/sync.ts` · CLI `inventory:sync`.  
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
