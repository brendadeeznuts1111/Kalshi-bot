# Domain matrix (sports / live products / skins)

Standalone registry for live PPH coverage. **Not** owned by Fantasy402.

## Layers

| Layer             | Owns                                         | Examples                                                                            |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Sports**        | Canonical `SportId`                          | `soccer`, `table_tennis`                                                            |
| **Competitions**  | Canonical leagues under a sport + Plive map  | `table_tennis.setka_cup` · [`competitions.ts`](competitions.ts)                     |
| **Odds line**     | Pandora coefficients only                    | `OddsLine` · period/marketType/selection · [`odds-selection.ts`](odds-selection.ts) |
| **Ticket leg**    | Place-bet componentBet only                  | `TicketLeg` · periodId/marketId/key · same file                                     |
| **Live products** | Coverage bindings + stream endpoints         | `plive`, `ezlive`, `ultralive`, `maglive` · `live-product-endpoints.ts`             |
| **Skins**         | White-labels + hosts + offered live products | `buckeye`, `ace`, `metallic`, `sts`, `1bv`, `lvaction`, `magnum`                    |
| **Books**         | Desk brands under a skin (host-derived)      | `fantasy402`, `parlay21`, `classic.lvaction.com` · [`books.ts`](books.ts)           |
| **Outs**          | Capacity / credentials                       | `out-SPEN-1` + live-product wire                                                    |

### Competitions (Plive-aware)

Stream-list inventory sends **bucket + `league` string** (no markets, no numeric
sport id on the event). Seed + resolve:

```ts
import { resolveCompetition } from '../domain/index.ts';

resolveCompetition({
  liveProduct: 'plive',
  sportId: 'table_tennis',
  league: 'Setka Cup',
}); // → table_tennis.setka_cup

// ezlive shares the plive shell mapping
resolveCompetition({
  liveProduct: 'ezlive',
  streamBucket: 'table_tennis',
  league: 'Masters. Poland. Women',
}); // → table_tennis.masters_poland_women (gender: women)
```

Unknown / junk league labels return `undefined`. Inventory upsert stamps
`skin_events.competition_id` when the league resolves (null otherwise).

### Three planes (inventory · odds · ticket)

```ts
import {
  describeOddsLine,
  describeTicketLeg,
  EXAMPLE_DARIN_PLACHY_ODDS_LINE,
  EXAMPLE_DARIN_PLACHY_TICKET_LEG,
  ticketLegFromOddsLine,
} from '../domain/index.ts';

describeOddsLine(EXAMPLE_DARIN_PLACHY_ODDS_LINE);
// → odds event=196878741 period=match market=moneyline selection=2

describeTicketLeg(EXAMPLE_DARIN_PLACHY_TICKET_LEG);
// → ticket event=196878741 period=match market=moneyline key=2

// Explicit bridge only — types stay distinct
ticketLegFromOddsLine(EXAMPLE_DARIN_PLACHY_ODDS_LINE);
```

| Plane     | Type                             | Do not mix with                        |
| --------- | -------------------------------- | -------------------------------------- |
| Inventory | `InventoryEventRef.streamId`     | odds / ticket eventId                  |
| Odds      | `OddsLine` (Pandora field names) | ticket without `ticketLegFromOddsLine` |
| Ticket    | `TicketLeg` (componentBet names) | odds without `oddsLineFromTicketLeg`   |

Desk hosts live only in `SKINS[].hosts`. Stream/widget infra URLs live only in
`live-product-endpoints.ts` (`PLIVE_STREAM_ENDPOINTS`,
`STATSCORE_BOOKED_EVENTS`).

## Skin table

Generated from `buildSkinMatrixRows()` / `bun run partner:skins` — do not
hand-edit product or gap columns; change [`skins.ts`](skins.ts) instead.

| Skin         | Active | Live products              | Books                                                | Hosts                                                        | Mapper / gaps                                     |
| ------------ | ------ | -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| **buckeye**  | yes    | PLive, EZLive              | betwest, fantasy402, hulkwager                       | betwest.com, fantasy402.com, hulkwager.com                   | **fantasy402**                                    |
| **ace**      | yes    | EZLive, UltraLive, MagLive | lonestarwagering, parlay21                           | parlay21.com, lonestarwagering.com                           | unmapped (mapper_unmapped)                        |
| **metallic** | yes    | (none)                     | gator747, orange777, paradisewager, sunwager         | paradisewager.com, orange777.com, sunwager.com, gator747.com | unmapped (missing_live_products, mapper_unmapped) |
| **sts**      | yes    | (none)                     | gomobilewager, wagerattack                           | wagerattack.ag, gomobilewager.com                            | unmapped (missing_live_products, mapper_unmapped) |
| **1bv**      | yes    | (none)                     | anybet365, betvegas23                                | anybet365.com, betvegas23.com                                | unmapped (missing_live_products, mapper_unmapped) |
| **lvaction** | yes    | (none)                     | archive.lvaction.com, classic.lvaction.com, lvaction | lvaction.com, classic.lvaction.com, archive.lvaction.com     | unmapped (missing_live_products, mapper_unmapped) |
| **magnum**   | yes    | (none)                     | 50centjuice, probooknyc                              | probooknyc.com, 50centjuice.com                              | unmapped (missing_live_products, mapper_unmapped) |

**Invariant:** `active: true` ⇒ `hosts.length ≥ 1`
(`assertActiveSkinsHaveHosts`). **Fingerprint gate:** active skins need
fingerprints or membership in `FINGERPRINT_PENDING_SKINS`
(`assertFingerprintCoverage`). Desk URL env: `PARTNER_DOMAIN` (or per-out
`*DOMAIN`) must be a host in an active skin. Bare book-level DOMAIN env keys are
retired (`RETIRED_BARE_BOOK_DOMAIN_ENVS`). `fantasy402` alias → skin `buckeye`
(mapper token / BookId, not SkinId). Host → `BookId` → `SkinId` (`getBookByHost`
/ `resolveBookId` in [`books.ts`](books.ts)).

```bash
bun run partner:skins
bun run partner:skins -- --json
bun run partner:books
bun run partner:books -- --json
```

## Unknown host

```bash
bun run partner:host-discover -- --url=https://example.com
```

Suggests skin from weighted fingerprints (`SKINS[].fingerprints` +
DNS/TLS/HTML). Confirm, then add hostname to `SKINS[].hosts` — discovery never
auto-maps. `--weigh` prints capped category contributions + decision threshold.

## Write path (partner outs)

Host is the gateway on account seed/upsert via **OutIdentity**
(`partner/out-identity.ts`):

1. `getSkinByHost(url)` → `SkinId` (unknown host → reject)
2. `getBookByHost(url)` → desk `BookId` (optional stamp)
3. Parse capacity from `meta.liveProducts` (dual-read legacy `meta.skins`)
4. Assert capacity ⊆ `offeredLiveProducts` (+ `dark` / numeric Ultra wire)
5. Derive `AdapterBinding` (`adapterId`: `fantasy-ultra` | `kalshi` |
   `unmapped`)
6. Stamp `skinId`, `bookId`, `mapper`, `liveProducts` + legacy `skins` mirror,
   `defaultLiveProduct`
7. `getPartnerAdapter` switches on `adapterId === "fantasy-ultra"` (not partner
   string)

```ts
import {
  resolveSkinId,
  resolveBookId,
  getSkinByHost,
  getBookByHost,
  skinOffersLiveProduct,
  bookOffersLiveProduct,
  skinOfferedCatalogNames,
  resolveSport,
} from '../domain/index.ts';

resolveSkinId('fantasy402'); // "buckeye"
resolveBookId('fantasy402'); // "fantasy402"
getSkinByHost('https://www.parlay21.com/login'); // "ace"
getBookByHost('https://www.parlay21.com/login'); // "parlay21"
skinOffersLiveProduct('buckeye', 'EZLive'); // true
bookOffersLiveProduct('fantasy402', 'EZLive'); // true
skinOfferedCatalogNames('buckeye'); // ["PLive", "EZLive"]
resolveSport({ liveProduct: 'plive', apiSportId: 93 }); // table_tennis
```
