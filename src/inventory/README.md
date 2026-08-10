# Inventory plane

Coverage catalog for live-product stream inventory (**not** seat partner).

| Module | Role |
| ------ | ---- |
| `sports-inventory.ts` | Parse / fetch stream-list-v2 sports + league counts |
| `skin-events-store.ts` | Upsert events into `skin_events` (+ competition_id) |
| `sync.ts` | Poll adapter inventory → store (optional Statscore enrich) |

CLIs:

```bash
bun run domain:sports
bun run inventory:sync -- --sport=all --dry-run   # plan inserts/updates, no write
bun run inventory:sync -- --sport=all
bun run inventory:watch
```

Domain SSOT for sport tiers / competitions: `src/domain/`.  
Book adapter (login / fetchInventory): `src/partner/fantasy-ultra/`.  
Doc: [`docs/FANTASY-ULTRA.md`](../../docs/FANTASY-ULTRA.md).
