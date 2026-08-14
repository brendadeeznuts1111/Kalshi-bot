# Inventory plane

Coverage catalog for live-product stream inventory (**not** seat partner).

**ezlive:** same SportsWidgets stream shell as plive — one `skin_events` row
per `(book_id, inventory_id)`; `coversLiveProducts` lists both when endpoints
exist. Seat capacity for ezlive is separate (`partner:toml`). Full operator
path: [`docs/INVENTORY.md`](../../docs/INVENTORY.md). Map-lane backlog (odds
link, unmapped leagues): [`docs/INVENTORY-MAP-BACKLOG.md`](../../docs/INVENTORY-MAP-BACKLOG.md).

| Module | Role |
| ------ | ---- |
| `sports-inventory.ts` | Parse / fetch stream-list-v2 sports + league counts |
| `skin-events-store.ts` | Upsert events into `skin_events` (+ competition_id) |
| `leagues.ts` | Durable `inventory_leagues` registry (survives id churn) |
| `sync.ts` | Poll adapter inventory → events + leagues |
| `session-plane-probe.ts` | Public vs gsid-gated plane probe (redacts secrets) |

CLIs:

```bash
bun run domain:sports
bun run inventory:sync -- --sport=all --dry-run   # plan inserts/updates, no write
bun run inventory:sync -- --sport=all             # full board write
# Multi-sport CSV (spaces OK): --sport=table_tennis,tennis,soccer,basketball
bun run inventory:sync -- --sport=all --enrich-booked --enrich-scope=board
bun run inventory:sync -- --odds-status           # odds_event_id fill-rate
bun run inventory:sync -- --enrich-only           # public Statscore name-link
bun run inventory:enrich                          # alias: enrich-only unlinked all
# Resilience: fetchWithRetry(403/429/5xx), cache TTL + stale fallback for
# stream-list + booked catalog; enrich-validate; enrichBookedEvents()
bun run inventory:watch -- --once --sport=all --dry-run
bun run inventory:watch -- --once --sport=all --enrich-booked
# Recommended capture profile (see docs/INVENTORY.md § Operator profile):
bun run inventory:watch -- --loop \
  --sport=table_tennis,tennis,soccer,basketball --interval-ms=30000
bun run inventory:watch -- --loop --sport=all     # continuous full board
bun run inventory:leagues                         # list durable leagues
bun run inventory:leagues -- --unmapped           # competition_id null
bun run inventory:leagues -- --harvest --sport=all
bun run inventory:leagues -- --resolve            # Map: score unmapped → existing seeds
bun run inventory:leagues -- --resolve --apply    # stamp conf≥threshold (default 0.9)
bun run inventory:leagues -- --report             # promote dry-report (cron-shared)
bun run inventory:leagues -- --report --notify    # force Telegram (TELEGRAM_*)
bun run inventory:leagues -- --promote            # plan COMPETITIONS seeds
bun run inventory:leagues -- --promote --apply    # write competitions.ts
bun run inventory:leagues -- --backfill           # re-stamp competition_id
# Map enrich batch: bun run inventory:sync -- --enrich-only --sport=tennis --limit=100
bun run inventory:session-probe                   # public list vs gsid streamToken
# PLIVE_GSID=… bun run inventory:session-probe    # optional bound session (never commit)
# cron: INVENTORY_SYNC=1 → events + leagues + promote-report (no auto-apply)
```

Report metrics: `seen` / `new` / `updated`, `sportHistogram`, `newBySport`,
`coversLiveProducts` (plive+ezlive on buckeye), `leagues` (durable registry).

Domain SSOT for sport tiers / competitions: `src/domain/`.  
Book adapter (login / fetchInventory): `src/partner/fantasy-ultra/`.  
Playbook: [`docs/INVENTORY.md`](../../docs/INVENTORY.md) ·
[`docs/FANTASY-ULTRA.md`](../../docs/FANTASY-ULTRA.md).
