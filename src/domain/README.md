# Domain matrix (sports / live products / skins)

Standalone registry for live PPH coverage. **Not** owned by Fantasy402.

## Layers

| Layer             | Owns                                         | Examples                                                              |
| ----------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| **Sports**        | Canonical `SportId`                          | `soccer`, `table_tennis`                                              |
| **Live products** | Coverage bindings + stream endpoints         | `plive`, `ezlive`, `ultralive`, `maglive` · `live-product-endpoints.ts` |
| **Skins**         | White-labels + hosts + offered live products | `buckeye`, `ace`, `metallic`, `sts`, `1bv`, `lvaction`, `magnum`      |
| **Outs**          | Capacity / credentials                       | `out-SPEN-1` + live-product wire                                      |

Desk hosts live only in `SKINS[].hosts`. Stream/widget infra URLs live only in
`live-product-endpoints.ts` (`PLIVE_STREAM_ENDPOINTS`, `STATSCORE_BOOKED_EVENTS`).

## Skin table

Generated from `buildSkinMatrixRows()` / `bun run partner:skins` — do not hand-edit
product or gap columns; change [`skins.ts`](skins.ts) instead.

| Skin         | Active | Live products              | Hosts                       | Mapper / gaps |
| ------------ | ------ | -------------------------- | --------------------------- | ------------- |
| **buckeye** | yes | PLive, EZLive | betwest.com, fantasy402.com, hulkwager.com | **fantasy402** |
| **ace** | yes | EZLive, UltraLive, MagLive | parlay21.com, lonestarwagering.com | unmapped (mapper_unmapped) |
| **metallic** | yes | (none) | paradisewager.com, orange777.com, sunwager.com, gator747.com | unmapped (missing_live_products, mapper_unmapped) |
| **sts** | yes | (none) | wagerattack.ag, gomobilewager.com | unmapped (missing_live_products, mapper_unmapped) |
| **1bv** | yes | (none) | anybet365.com, betvegas23.com | unmapped (missing_live_products, mapper_unmapped) |
| **lvaction** | yes | (none) | lvaction.com, classic.lvaction.com, archive.lvaction.com | unmapped (missing_live_products, mapper_unmapped) |
| **magnum** | yes | (none) | probooknyc.com, 50centjuice.com | unmapped (missing_fingerprints, missing_live_products, mapper_unmapped) |

**Invariant:** `active: true` ⇒ `hosts.length ≥ 1` (`assertActiveSkinsHaveHosts`).
**Fingerprint gate:** active skins need fingerprints or membership in
`FINGERPRINT_PENDING_SKINS` (`assertFingerprintCoverage`).
Desk URL env: `PARTNER_DOMAIN` (or per-out `*DOMAIN`) must be a host in an active skin.
Bare book-level DOMAIN env keys are retired (`RETIRED_BARE_BOOK_DOMAIN_ENVS`).
`fantasy402` alias → skin `buckeye` (mapper token, not SkinId).

```bash
bun run partner:skins
bun run partner:skins -- --json
```

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
