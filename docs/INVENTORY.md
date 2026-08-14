# Inventory coverage playbook (plive shell + ezlive)

**Status:** complete for Buckeye / Fantasy402 (PR1 full-board · PR2 durable
leagues · PR3 promote · PR4 docs).

Coverage catalog for **live board events** and **durable leagues** on the
shared SportsWidgets stream shell. **Not** seat-partner capital. **Not**
priced markets. Settlement / void / action rules (for weighting lines &
movement): [`PLIVE-EZLIVE-SPORTS-RULES.md`](PLIVE-EZLIVE-SPORTS-RULES.md)
(plive = ezlive; same shell Rules panel).

| Plane | Owns | Typical CLIs |
| ----- | ---- | ------------ |
| **Domain** | Sport tiers, competitions, stream endpoints | `domain:sports` · `domain:skins` |
| **Inventory** | Poll → `skin_events` + `inventory_leagues` | `inventory:sync` · `inventory:watch` · `inventory:leagues` |
| **Seat** | Outs / capacity / secrets / place-bet | `partner:toml` · `partner:capacity` · `ops:status` |

## What ezlive is (and is not)

| Question | Answer |
| -------- | ------ |
| Does ezlive have its own stream-list? | **No** — same `stream-list-v2` as plive |
| Separate `skin_events` rows for ezlive? | **No** — one row per `(book_id, inventory_id)` |
| How does an out “trade ezlive”? | Seat **capacity** row `name = "ezlive"` + session wire |
| Where do league ids come from? | Domain `COMPETITIONS` via `resolveCompetition` (plive mappings; ezlive reuses) |
| ACE / UltraLive / MagLive inventory? | **Out of this playbook** until stream endpoints exist |

```text
                    ┌─────────────────────────────────────┐
  stream-list-v2    │  inventory shell (plive stamp)      │
  SportsWidgets ──▶ │  skin_events · inventory_leagues    │ covers: plive+ezlive
                    └──────────────┬──────────────────────┘
                                   │ competition_id
                                   ▼
                    COMPETITIONS (domain seeds / promote)
                                   │
         seat capacity (per out)   │   execution wire
         live_products=ezlive  ────┴──▶ PlaceBet / Ultra form skin field
```

## Shell model

| Live product | Stream feed | Event row stamp |
| ------------ | ----------- | --------------- |
| **plive** | `stream-list-v2` (SportsWidgets) | `inventory_live_product=plive` (shell owner) |
| **ezlive** | **Same feed** (shared shell) | **Same rows** — do **not** dual-write |

`liveProductsCoveredByInventory('buckeye')` → `['plive','ezlive']` when both
have stream endpoints in domain (`streamEndpointsForLiveProduct`).

UltraLive / MagLive: no stream endpoints on Buckeye path yet — seat capacity
only if an out is wired; **no** inventory harvest here.

## Operator profile (recommended)

**Goal:** continuous, scoped capture without hammering the feed or coupling
mapping work into the hot path. One long-running watcher is enough.

### Two-lane mental model

| Lane | Owns | Runs when | Does **not** do |
| ---- | ---- | --------- | --------------- |
| **Capture** | stream-list → `skin_events` + `inventory_leagues` | always-on loop (or cron) | enrich, promote, seat wire |
| **Map** | `competition_id`, seeds, `odds_event_id` soft-link | operator / offline batch | continuous poll |

Capture is cheap and idempotent. Map is reviewable and reversible (dry-run
first). Do **not** put `--enrich-booked` or `--promote --apply` on the Capture
loop.

### Recommended Capture profile

| Knob | Value | Why |
| ---- | ----- | --- |
| Sports | **core** CSV (not full `all` unless needed) | board is ~100–180 events; scope keeps noise down |
| Interval | `30000` ms (default) | near-real-time without thrashing |
| Enrich | **off** on the loop | Statscore name-match is Map lane |
| Promote | **off** on the loop | never auto-apply seeds from capture |
| Runner | single `inventory:watch --loop` | one process; avoid double-poll with cron |

**Core sports** (domain primary tier): `table_tennis`, `tennis`, `soccer`,
`basketball`. Stream wire labels soccer as **Football**; `--sport=soccer` (or
`football`) matches via normalized sportId — American Football is a separate
token (`american_football`).

```bash
# Capture — recommended continuous profile
bun run inventory:watch -- --loop \
  --sport=table_tennis,tennis,soccer,basketball \
  --interval-ms=30000

# Spaces around commas are fine:
bun run inventory:watch -- --loop --sport="table_tennis, tennis"

# Single sport still works (interactive default when --sport omitted: table_tennis)
bun run inventory:watch -- --once --sport=table_tennis --dry-run --json

# Full board when you need every stream bucket:
bun run inventory:watch -- --loop --sport=all --interval-ms=30000
```

`--sport` accepts:

| Form | Behavior |
| ---- | -------- |
| `all` | full board |
| one token (`tennis`) | fetch + filter that sport |
| CSV (`table_tennis, tennis`) | fetch full board, client filter (union); spaces trimmed |

### Map lane (separate sessions)

Never on the 30s Capture loop. Cadence:

| Task | Frequency | Command |
| ---- | --------- | ------- |
| **Resolve** leagues → existing seeds | daily / after harvest | `inventory:leagues -- --resolve [--apply]` |
| **Promote** new COMPETITIONS seeds | operator review | `--promote` then `--promote --apply` |
| **Enrich** odds_event_id | every few hours | `inventory:enrich` / `--enrich-only` with `--limit` |
| Review stragglers | weekly | `--unmapped` + enrich quality JSON |

```bash
# 1) Stamp unmapped leagues from existing COMPETITIONS (scored; dry-run first)
bun run inventory:leagues -- --resolve --json
bun run inventory:leagues -- --resolve --sport=tennis --threshold=0.9
bun run inventory:leagues -- --resolve --apply --threshold=0.9
# conf < threshold stays for review; conf=0 → promote or junk

# Soft-link odds_event_id (metadata only — not prices)
bun run inventory:sync -- --sport=all --enrich-booked --enrich-scope=board --dry-run --json
bun run inventory:sync -- --enrich-only --enrich-scope=unlinked
# Map-lane batch (sport + limit — do not hammer Statscore)
bun run inventory:sync -- --enrich-only --sport=tennis --limit=100 --dry-run --json
bun run inventory:enrich   # alias: enrich-only unlinked all

# Promote unmapped leagues → new COMPETITIONS seeds (always plan before apply)
bun run inventory:leagues -- --promote
bun run inventory:leagues -- --promote --apply
bun run inventory:leagues -- --backfill
```

### Cron vs watch

- Prefer **one** Capture runner: either `inventory:watch --loop` **or**
  `INVENTORY_SYNC=1` cron — not both on the same host.
- Cron default sport is `all`; pin with `INVENTORY_SYNC_SPORT=table_tennis,tennis`
  when you want the same core profile under cron.
- Cron may emit promote-**report** (Telegram); it does **not** auto-apply.

## Operator checklist (end-to-end)

Use this when standing up or verifying **ezlive-ready coverage** on Buckeye:

1. **Dry-run inventory** (no SQLite writes):
   ```bash
   bun run domain:sports -- --json
   bun run inventory:watch -- --once --sport=all --dry-run --json
   # expect: coversLiveProducts includes plive+ezlive, seen > 0
   ```
2. **Live capture** (continuous; ids churn) — prefer **core sports**, not always `all`:
   ```bash
   bun run inventory:watch -- --loop \
     --sport=table_tennis,tennis,soccer,basketball \
     --interval-ms=30000
   # full board when needed: --sport=all
   # or cron: INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 bun run cron:start
   ```
3. **Durable leagues** (survive `inventory_id` rotation):
   ```bash
   bun run inventory:leagues
   bun run inventory:leagues -- --unmapped
   ```
4. **Promote unmapped → COMPETITIONS** (operator apply, not cron):
   ```bash
   bun run inventory:leagues -- --promote
   bun run inventory:leagues -- --promote --apply
   bun run inventory:leagues -- --backfill   # fresh process → skin_events
   ```
5. **Seat: enable ezlive capacity** on the out (inventory already shared):
   ```toml
   # config/partners.toml
   live_products = [
     { name = "ezlive", per_bet_max = 500, max_win = 2500, active = true },
   ]
   url = "https://fantasy402.com"   # buckeye host
   ```
   ```bash
   bun run partner:toml -- --diff
   bun run partner:toml -- --seed
   bun run partner:capacity -- --json
   ```
6. **Session wire** for execution: `LIVE_PRODUCT=ezlive` / Ultra form `skin`
   field — capacity/session only, **not** a second inventory store.

## Full-board / scoped capture

The live board **rotates** (`inventory_id` churn). One-shot polls never equal
full history. Prefer continuous poll — **scoped core sports** for day-to-day
ops ([Operator profile](#operator-profile-recommended)); use `sport=all` when
you need every stream bucket.

### Dry-run first

```bash
bun run domain:sports -- --json
bun run inventory:watch -- --once --sport=table_tennis,tennis --dry-run --json
# or full board plan:
bun run inventory:watch -- --once --sport=all --dry-run --json
bun run inventory:sync -- --sport=all --dry-run --json
```

Inspect: `seen`, `inserted` (new), `updated`, `sportHistogram`,
`coversLiveProducts`, `leagues`.

### Live write

```bash
# One-shot full board
bun run inventory:sync -- --sport=all --once

# Scoped multi-sport (CSV; spaces OK)
bun run inventory:sync -- --sport="table_tennis, tennis, soccer, basketball" --once

# Loop (30s) — recommended operator profile
bun run inventory:watch -- --loop \
  --sport=table_tennis,tennis,soccer,basketball \
  --interval-ms=30000

# Full-board loop when needed
bun run inventory:watch -- --loop --sport=all --interval-ms=30000

# Cron (default sport=all when INVENTORY_SYNC=1)
INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 bun run cron:start
# optional narrow (CSV supported same as CLI):
# INVENTORY_SYNC_SPORT=table_tennis,tennis
```

### What “new” means

- **New** = first time this `book_id` + `inventory_id` is seen → insert + log `+ …`
- **Update** = same id still/again on board → refresh row fields
- Leaving the board does **not** delete the row (history retained)
- Logging: CLI `+` lines; cron `[cron:inventory] + sport · league · … · id` (up to 12);
  optional Telegram on `inventory:watch` inserts when bot env set
- **New league** (`+L`): first time `(book, bucket, league_key_norm)` is seen in
  `inventory_leagues` (labels recur after event ids rotate). Cron also logs
  `leagues:` summary + up to 8 `+L` lines per tick.

## Metrics per tick

| Field | Meaning |
| ----- | ------- |
| `seen` | Events on this poll |
| `inserted` / `new` | First-time inventory_ids |
| `updated` | Existing ids refreshed |
| `sportHistogram` | Counts by normalized sport |
| `newBySport` | Inserts by sport |
| `coversLiveProducts` | e.g. `plive+ezlive` on Buckeye |
| `leagues` | Durable registry upsert (`seen` / `inserted` / `updated` / `newLeagues`) |
| `enriched` / `enrichCandidates` | Soft Statscore name → `odds_event_id` matches (metadata only) |
| `pricedEventCount` / `pricedLineCount` | Pandora `CoefficientStore` sizes when adapter has lines |
| `oddsLink` | Book fill-rate: linked/total (`odds_event_id` non-empty) |

## Odds handoff (metadata ≠ prices)

Stream-list has **no** American/decimal prices. Optional enrich only stamps
`odds_event_id` via Statscore booked-events **name** soft-match:

```bash
# Default scope=board: new inserts + on-board rows still missing odds_event_id
bun run inventory:sync -- --sport=all --enrich-booked
bun run inventory:sync -- --sport=all --enrich-booked --enrich-scope=new
bun run inventory:sync -- --sport=all --enrich-booked --enrich-scope=unlinked
bun run inventory:sync -- --sport=all --enrich-booked --dry-run --json
bun run inventory:sync -- --odds-status              # fill-rate only
# Public Statscore catalog (no Fantasy secrets) → re-link unlinked rows:
bun run inventory:enrich
bun run inventory:sync -- --enrich-only --enrich-scope=unlinked
bun run inventory:sync -- --enrich-only --dry-run --json
# Programmatic:
#   import { enrichBookedEvents } from './src/inventory/enrich-booked.ts'
# Resilience caches (TTL + stale fallback on 403):
#   research/cache/booked-catalog-cache.json
#   research/cache/stream-list-cache.json
# Post-tick: enrich-validate + JSON logs (plane=inventory component=enrich)
bun run inventory:watch -- --once --sport=all --enrich-booked

# Cron (scope via INVENTORY_SYNC_ENRICH_SCOPE=board|new|unlinked)
INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 INVENTORY_SYNC_ENRICH_BOOKED=1 bun run cron:start
```

| Scope | Candidates |
| ----- | ---------- |
| `new` | This poll’s inserts only |
| `board` (default) | Inserts + this-poll updates still unlinked |
| `unlinked` | All null `odds_event_id` for the book (capped) |

**Priced odds** still require Pandora coefficients (`partner:pandora-probe` /
webview capture) → `CoefficientStore` → report `pricedOdds: true`. No
`match_liquidity` merge yet.

## Sport tiers (domain)

Same map for plive and ezlive (`live-product-sport-bindings`):

- **primary (4):** soccer, tennis, basketball, table_tennis (API + widget ids)
- **inventory (26):** remaining stream buckets, no API id yet

```bash
bun run domain:sports -- --map
```

## Durable leagues (`inventory_leagues`)

Event `inventory_id`s rotate; **league labels recur**. On every
`inventory:sync` / `inventory:watch` poll we also upsert:

`UNIQUE(book_id, inventory_bucket, league_key_norm)`

| Column | Role |
| ------ | ---- |
| `event_count_live` | Events on this poll for that league (0 when off board) |
| `peak_event_count` | Max live count ever observed |
| `competition_id` | From `resolveCompetition` when known; else null |
| `first_seen` / `last_seen` | Registry lifetime |

```bash
# List registry (after at least one live sync/watch)
bun run inventory:leagues
bun run inventory:leagues -- --unmapped
bun run inventory:leagues -- --sport=table_tennis --order=peak --json

# Harvest via full-board sync path (also writes skin_events unless --dry-run)
bun run inventory:leagues -- --harvest --sport=all --dry-run
bun run inventory:leagues -- --harvest --sport=all
```

## Competitions

Hand-seeded `COMPETITIONS` + `resolveCompetition` (ezlive uses **plive**
mappings — shared shell). Unmapped leagues leave `competition_id` null on both
`skin_events` and `inventory_leagues`.

Resolve hygiene: `matchLeagueKey` treats dots/underscores like spaces
(`ATT. Togliatti` ≡ `ATT Togliatti`). `sportId` is never used as the stream
bucket (`soccer` → `football` via bindings). Re-stamp after seed changes:
`bun run inventory:leagues -- --backfill`.

### Promote unmapped → COMPETITIONS

Junk filters drop matchup blobs (`A - B`), person initials (`Vitaliy S`), and
short structure-less labels. Survivors mint
`{sportId}.{slug}` + plive `{inventoryBucket, leagueKey}`.

```bash
# Plan / report (default dry-run — shared with cron promote-report)
bun run inventory:leagues -- --report
bun run inventory:leagues -- --promote
bun run inventory:leagues -- --promote --min-peak=2 --json

# Write src/domain/competitions.ts + stamp inventory_leagues
bun run inventory:leagues -- --promote --apply

# After apply, fresh process stamps skin_events too
bun run inventory:leagues -- --backfill
```

Promote **apply** is **operator-driven** (reviews seeds into source). Cron
harvests events/leagues and logs a **promote-report** summary when candidates
exist; it does **not** auto-apply COMPETITIONS
(`INVENTORY_PROMOTE_REPORT=0` to silence).

```bash
# Force Telegram once (needs TELEGRAM_*); updates dedup state
bun run inventory:leagues -- --report --notify

# Cron: only when new candidate ids appear
INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 INVENTORY_PROMOTE_TELEGRAM=1 \
  TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=… bun run cron:start
```

## ezlive capacity recipe (seat)

Inventory is **already** shared for plive+ezlive. Enabling ezlive trading is a
**seat** change only:

```toml
# config/partners.toml out
live_products = [
  { name = "ezlive", per_bet_max = 500, max_win = 2500, active = true },
]
url = "https://fantasy402.com"   # must be a Buckeye SKINS[].hosts URL
```

```bash
bun run partner:toml -- --diff
bun run partner:toml -- --seed
bun run partner:capacity -- --json
# inventory still (unchanged by capacity):
bun run inventory:sync -- --sport=all --dry-run
```

Liquidity key for concentration: `{outId}@ezlive` (e.g. `out-SPEN-1@ezlive`).

Session wire `LIVE_PRODUCT=ezlive` / Ultra form `skin` field is capacity/session —
not a second inventory store. Details:
[`SEAT-OPS.md`](SEAT-OPS.md) · [`FANTASY-ULTRA.md`](FANTASY-ULTRA.md) § capacity.

## Verification (smoke)

| Check | Command / expect |
| ----- | ---------------- |
| Shell covers ezlive | dry-run JSON `coversLiveProducts` includes `ezlive` |
| Full board | `seen` ≫ 0 with `--sport=all` |
| Leagues durable | `inventory:leagues` total grows across polls; peak ≥ live |
| Competitions | mapped leagues show `comp=` on `+` lines; unmapped → promote |
| Seat ezlive | `partner:capacity` shows active ezlive row for the out |
| No dual rows | `COUNT(*)` on `skin_events` not doubled when out has both products |

## Common mistakes

| Mistake | Fix |
| ------- | --- |
| Dual-writing ezlive event rows | Keep one `inventory_live_product=plive` shell stamp |
| Expecting inventory without continuous poll | Run watch/cron (core CSV or `sport=all`) — see [Operator profile](#operator-profile-recommended) |
| Enrich/promote on the capture loop | Keep Capture lean; Map lane is offline |
| Treating person/matchup labels as leagues | Use `--promote` junk filter; do not hand-seed junk |
| Seeding capacity as “inventory product” | Capacity is seat; harvest is domain/inventory |
| ACE ultralive coverage via this feed | Wrong shell — no stream endpoint here |

## CLI map

| Command | Role |
| ------- | ---- |
| `domain:sports` | Stream snapshot + static map + sport map seed |
| `inventory:sync -- --sport=… [--dry-run] [--enrich-booked]` | Adapter poll → events + leagues (+ odds_event_id); sport = single / CSV / all |
| `inventory:sync -- --odds-status` | `odds_event_id` fill-rate for book |
| `inventory:sync -- --enrich-only` / `inventory:enrich` | Public booked catalog → link unlinked rows (no stream poll) |
| `inventory:watch -- --sport=… [--once] [--dry-run] [--enrich-booked]` | Public/adapter poll → events + leagues; multi-sport CSV supported |
| `inventory:leagues [--unmapped] [--harvest]` | List / harvest durable league registry |
| `inventory:leagues -- --resolve [--apply] [--threshold=0.9]` | Map lane: stamp unmapped from existing seeds (scored) |
| `inventory:leagues -- --report [--notify]` | Promote dry-report; optional force Telegram |
| `inventory:leagues -- --promote [--apply]` | Plan/apply COMPETITIONS seeds from unmapped |
| `inventory:leagues -- --backfill` | Re-stamp competition_id on leagues + skin_events |
| `inventory:session-probe` | Public stream-list vs gsid-gated streamToken (redacts secrets) |
| Cron `INVENTORY_SYNC=1` | Full board default (`sport=all`); events + leagues |
| `partner:toml` / `partner:capacity` | Seat outs — ezlive limits (not inventory) |

## See also

- [`INVENTORY-MAP-BACKLOG.md`](INVENTORY-MAP-BACKLOG.md) — Map-lane weakest points + next work queue
- [`FANTASY-ULTRA.md`](FANTASY-ULTRA.md) — adapter / wire / Pandora
- [`src/inventory/README.md`](../src/inventory/README.md) — module map
- [`src/domain/README.md`](../src/domain/README.md) — competitions + promote
- [`SEAT-OPS.md`](SEAT-OPS.md) — seat outs / capacity
- [`CRON.md`](CRON.md) — `INVENTORY_SYNC` job
