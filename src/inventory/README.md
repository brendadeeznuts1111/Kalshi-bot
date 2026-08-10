# Inventory plane

Coverage catalog for live-product stream inventory (**not** seat partner).

| Module | Role |
| ------ | ---- |
| `sports-inventory.ts` | Parse / fetch stream-list-v2 sports + league counts |
| `skin-events-store.ts` | Upsert events into `skin_events` (+ competition_id) |
| `leagues.ts` | Durable `inventory_leagues` registry (survives id churn) |
| `sync.ts` | Poll adapter inventory → events + leagues |

CLIs:

```bash
bun run domain:sports
bun run inventory:sync -- --sport=all --dry-run   # plan inserts/updates, no write
bun run inventory:sync -- --sport=all             # full board write
bun run inventory:watch -- --once --sport=all --dry-run
bun run inventory:watch -- --loop --sport=all     # continuous full board
bun run inventory:leagues                         # list durable leagues
bun run inventory:leagues -- --unmapped           # competition_id null
bun run inventory:leagues -- --harvest --sport=all
bun run inventory:leagues -- --promote            # plan COMPETITIONS seeds
bun run inventory:leagues -- --promote --apply    # write competitions.ts
bun run inventory:leagues -- --backfill           # re-stamp competition_id
# cron: INVENTORY_SYNC=1 → sport=all by default
```

Report metrics: `seen` / `new` / `updated`, `sportHistogram`, `newBySport`,
`coversLiveProducts` (plive+ezlive on buckeye), `leagues` (durable registry).

Domain SSOT for sport tiers / competitions: `src/domain/`.  
Book adapter (login / fetchInventory): `src/partner/fantasy-ultra/`.  
Playbook: [`docs/INVENTORY.md`](../../docs/INVENTORY.md) ·
[`docs/FANTASY-ULTRA.md`](../../docs/FANTASY-ULTRA.md).
