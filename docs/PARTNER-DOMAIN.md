# Partner domain architecture (moved)

**Canonical seat-ops doc:** [`SEAT-OPS.md`](SEAT-OPS.md)  
**Fantasy Ultra + inventory:** [`FANTASY-ULTRA.md`](FANTASY-ULTRA.md) ·
[`INVENTORY.md`](INVENTORY.md)

Seat-ops (financial partner → outs → finance) and desk/inventory pointers live
there. This stub remains so old links keep resolving.

```bash
bun run ops:status
bun run domain:skins
bun run domain:books
bun run domain:host-discover -- --url=https://example.com
bun run domain:sports
bun run inventory:sync -- --sport=all
```
