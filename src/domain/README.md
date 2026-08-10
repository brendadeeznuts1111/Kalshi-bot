# Domain matrix (sports / live products / skins)

Standalone registry for live PPH coverage. **Not** owned by Fantasy402.

## Layers

| Layer             | Owns                                         | Examples                                                              |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| **Sports**        | Canonical `SportId`                          | `soccer`, `table_tennis`                                              |
| **Live products** | Coverage bindings                            | `plive`, `ezlive`, `ultralive`, `maglive` (catalog: PLive, EZLive, …) |
| **Skins**         | White-labels + hosts + offered live products | `buckeye`, `ace`, `metallic`, `sts`, `1bv`, `lvaction`, `magnum`      |
| **Outs**          | Capacity / credentials                       | `out-SPEN-1` + live-product wire                                      |

## Skin table

| Skin         | Active | Live products              | Hosts                       | Mapper         |
| ------------ | ------ | -------------------------- | --------------------------- | -------------- |
| **buckeye**  | yes    | PLive, EZLive              | betwest, fantasy402, hulkwager | **fantasy402** |
| **ace**      | yes    | EZLive, UltraLive, MagLive | parlay21.com, lonestarwagering.com | unmapped |
| **metallic** | yes    | TBD                        | paradise, orange777, sunwager, gator747 | unmapped |
| **sts**      | yes    | TBD                        | wagerattack.ag, gomobilewager.com | unmapped     |
| **1bv**      | yes    | TBD                        | anybet365.com, betvegas23.com | unmapped     |
| **lvaction** | yes    | TBD                        | lvaction.com, classic/archive.lvaction.com | unmapped |
| **magnum**   | yes    | TBD                        | probooknyc.com, 50centjuice.com | unmapped |

**Invariant:** `active: true` ⇒ `hosts.length ≥ 1` (`assertActiveSkinsHaveHosts`).
Desk URL env: `PARTNER_DOMAIN` (not `FANTASY402_DOMAIN`) must be a host in an active skin.
`fantasy402` alias → skin `buckeye` (mapper token, not SkinId).

## Unknown host

```bash
bun run partner:host-discover -- --url=https://example.com
```

Suggests skin from weighted fingerprints (`SKINS[].fingerprints` + DNS/TLS/HTML).
Confirm, then add hostname to `SKINS[].hosts` — discovery never auto-maps.
`--weigh` prints capped category contributions + decision threshold.

## Write path (partner outs)

Host is the gateway on account seed/upsert via **OutIdentity**
(`partner/out-identity.ts`):

1. `getSkinByHost(url)` → `SkinId` (unknown host → reject)
2. Parse capacity from `meta.liveProducts` (dual-read legacy `meta.skins`)
3. Assert capacity ⊆ `offeredLiveProducts` (+ `dark` / numeric Ultra wire)
4. Derive `AdapterBinding` (`adapterId`: `fantasy-ultra` | `kalshi` |
   `unmapped`)
5. Stamp `skinId`, `mapper`, `liveProducts` + legacy `skins` mirror,
   `defaultLiveProduct`
6. `getPartnerAdapter` switches on `adapterId === "fantasy-ultra"` (not partner
   string)

```ts
import {
  resolveSkinId,
  getSkinByHost,
  skinOffersLiveProduct,
  skinOfferedCatalogNames,
  resolveSport,
} from '../domain/index.ts';

resolveSkinId('fantasy402'); // "buckeye"
getSkinByHost('https://www.parlay21.com/login'); // "ace"
skinOffersLiveProduct('buckeye', 'EZLive'); // true
skinOfferedCatalogNames('buckeye'); // ["PLive", "EZLive"]
resolveSport({ liveProduct: 'plive', apiSportId: 93 }); // table_tennis
```
