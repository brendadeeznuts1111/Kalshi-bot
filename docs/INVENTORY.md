# Inventory coverage playbook (plive shell + ezlive)

**Status:** complete for Buckeye / Fantasy402 (PR1 full-board · PR2 durable
leagues · PR3 promote · PR4 docs).

Coverage catalog for **live board events** and **durable leagues** on the
shared SportsWidgets stream shell. **Not** seat-partner capital. **Not**
priced markets.

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

## Operator checklist (end-to-end)

Use this when standing up or verifying **ezlive-ready coverage** on Buckeye:

1. **Dry-run inventory** (no SQLite writes):
   ```bash
   bun run domain:sports -- --json
   bun run inventory:watch -- --once --sport=all --dry-run --json
   # expect: coversLiveProducts includes plive+ezlive, seen > 0
   ```
2. **Live full-board capture** (continuous; ids churn):
   ```bash
   bun run inventory:watch -- --loop --sport=all --interval-ms=30000
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

## Full-board capture

The live board **rotates** (`inventory_id` churn). One-shot polls never equal
full history. Prefer continuous full-board poll (`sport=all`).

### Dry-run first

```bash
bun run domain:sports -- --json
bun run inventory:watch -- --once --sport=all --dry-run --json
# or
bun run inventory:sync -- --sport=all --dry-run --json
```

Inspect: `seen`, `inserted` (new), `updated`, `sportHistogram`,
`coversLiveProducts`, `leagues`.

### Live write

```bash
# One-shot full board
bun run inventory:sync -- --sport=all --once

# Loop (30s)
bun run inventory:watch -- --loop --sport=all --interval-ms=30000

# Cron (default sport=all when INVENTORY_SYNC=1)
INVENTORY_SYNC=1 INVENTORY_SYNC_PUBLIC=1 bun run cron:start
# optional: INVENTORY_SYNC_SPORT=table_tennis to narrow
```

### What “new” means

- **New** = first time this `book_id` + `inventory_id` is seen → insert + log `+ …`
- **Update** = same id still/again on board → refresh row fields
- Leaving the board does **not** delete the row (history retained)
- Logging: CLI `+` lines; cron `[cron:inventory] + sport · league · … · id` (up to 12);
  optional Telegram on `inventory:watch` inserts when bot env set
- **New league** (`+L`): first time `(book, bucket, league_key_norm)` is seen in
  `inventory_leagues` (labels recur after event ids rotate)

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

### Promote unmapped → COMPETITIONS

Junk filters drop matchup blobs (`A - B`), person initials (`Vitaliy S`), and
short structure-less labels. Survivors mint
`{sportId}.{slug}` + plive `{inventoryBucket, leagueKey}`.

```bash
# Plan (default dry-run)
bun run inventory:leagues -- --promote
bun run inventory:leagues -- --promote --min-peak=2 --json

# Write src/domain/competitions.ts + stamp inventory_leagues
bun run inventory:leagues -- --promote --apply

# After apply, fresh process stamps skin_events too
bun run inventory:leagues -- --backfill
```

Promote is **operator-driven** (reviews seeds into source). Cron harvests
events/leagues only; it does **not** auto-apply COMPETITIONS.

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
| Expecting inventory without continuous poll | Run watch/cron `sport=all` |
| Treating person/matchup labels as leagues | Use `--promote` junk filter; do not hand-seed junk |
| Seeding capacity as “inventory product” | Capacity is seat; harvest is domain/inventory |
| ACE ultralive coverage via this feed | Wrong shell — no stream endpoint here |

## CLI map

| Command | Role |
| ------- | ---- |
| `domain:sports` | Stream snapshot + static map + sport map seed |
| `inventory:sync -- --sport=all [--dry-run]` | Adapter poll → events + leagues |
| `inventory:watch -- --sport=all [--once] [--dry-run]` | Public/adapter poll → events + leagues |
| `inventory:leagues [--unmapped] [--harvest]` | List / harvest durable league registry |
| `inventory:leagues -- --promote [--apply]` | Plan/apply COMPETITIONS seeds from unmapped |
| `inventory:leagues -- --backfill` | Re-stamp competition_id on leagues + skin_events |
| Cron `INVENTORY_SYNC=1` | Full board default (`sport=all`); events + leagues |
| `partner:toml` / `partner:capacity` | Seat outs — ezlive limits (not inventory) |

## See also

- [`FANTASY-ULTRA.md`](FANTASY-ULTRA.md) — adapter / wire / Pandora
- [`src/inventory/README.md`](../src/inventory/README.md) — module map
- [`src/domain/README.md`](../src/domain/README.md) — competitions + promote
- [`SEAT-OPS.md`](SEAT-OPS.md) — seat outs / capacity
- [`CRON.md`](CRON.md) — `INVENTORY_SYNC` job
