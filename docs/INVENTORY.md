# Inventory coverage playbook (plive shell + ezlive)

Coverage catalog for **live board events** and **durable leagues**.
**Not** seat-partner capital. **Not** priced markets.

| Plane | Owns |
| ----- | ---- |
| Domain | Sport tiers, competitions, stream endpoints (`src/domain/`) |
| Inventory | Poll → `skin_events` (`src/inventory/`) |
| Seat | Outs / capacity / secrets (`src/partner/`) |

## Shell model (ezlive)

| Live product | Stream feed | Event row stamp |
| ------------ | ----------- | --------------- |
| **plive** | `stream-list-v2` (SportsWidgets) | `inventory_live_product=plive` (shell) |
| **ezlive** | **Same feed** (shared shell) | Same rows — do **not** dual-write |

`liveProductsCoveredByInventory('buckeye')` → `['plive','ezlive']` when both
have stream endpoints. Capacity for an out that trades ezlive is separate
(`meta.liveProducts` / TOML `live_products` with `name = "ezlive"`).

UltraLive / MagLive: no stream endpoints yet — out of this playbook.

## Full-board capture (required for “coverage”)

The live board **rotates** (`inventory_id` churn). One-shot polls never equal
full history. Run continuous full-board poll:

### Dry-run first

```bash
bun run domain:sports -- --json
bun run inventory:watch -- --once --sport=all --dry-run --json
# or
bun run inventory:sync -- --sport=all --dry-run --json
```

Inspect: `seen`, `inserted` (new), `updated`, `sportHistogram`, `coversLiveProducts`.

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

## Metrics per tick

Report fields (sync; watch text/json similar):

| Field | Meaning |
| ----- | ------- |
| `seen` | Events on this poll |
| `inserted` / `new` | First-time inventory_ids |
| `updated` | Existing ids refreshed |
| `sportHistogram` | Counts by normalized sport |
| `newBySport` | Inserts by sport |
| `coversLiveProducts` | e.g. `plive+ezlive` |
| `leagues` | Durable league registry upsert (`seen` / `inserted` / `updated` / `newLeagues`) |

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

Hand-seeded `COMPETITIONS` + `resolveCompetition` (ezlive uses plive mappings).
Unmapped leagues leave `competition_id` null on both `skin_events` and
`inventory_leagues`.

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

## ezlive capacity recipe (seat)

Inventory is shared; **execution product** is per-out:

```toml
# config/partners.toml out
live_products = [
  { name = "ezlive", per_bet_max = 500, max_win = 2500, active = true },
]
url = "https://fantasy402.com"   # buckeye host
```

```bash
bun run partner:toml -- --diff
bun run partner:toml -- --seed
# inventory still:
bun run inventory:sync -- --sport=all --dry-run
```

Session wire `LIVE_PRODUCT=ezlive` / Ultra form `skin` field is capacity/session —
not a second inventory store.

## CLI map

| Command | Role |
| ------- | ---- |
| `domain:sports` | Stream snapshot + static map + sport map seed |
| `inventory:sync -- --sport=all [--dry-run]` | Adapter poll → events + leagues |
| `inventory:watch -- --sport=all [--once] [--dry-run]` | Public/adapter poll → events + leagues |
| `inventory:leagues [--unmapped] [--harvest]` | List / harvest durable league registry |
| `inventory:leagues -- --promote [--apply]` | Plan/apply COMPETITIONS seeds from unmapped |
| `inventory:leagues -- --backfill` | Re-stamp competition_id on leagues + skin_events |
| Cron `INVENTORY_SYNC=1` | Full board default (`sport=all`) |

## See also

- [`FANTASY-ULTRA.md`](FANTASY-ULTRA.md) — adapter / wire
- [`src/inventory/README.md`](../src/inventory/README.md) — module map
- [`SEAT-OPS.md`](SEAT-OPS.md) — seat outs / capacity
