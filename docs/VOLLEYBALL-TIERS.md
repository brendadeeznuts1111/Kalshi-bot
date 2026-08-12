# Volleyball competition tiers + NCAA seeds

**Code SSOT:** [`src/domain/volleyball-tiers.ts`](../src/domain/volleyball-tiers.ts)  
**Registry:** [`src/domain/competitions.ts`](../src/domain/competitions.ts) (`sportId: volleyball`)  
**Resolve:** `resolveCompetition` + `resolveVolleyballCompetitionTier`

## Desk tiers

| Tier | Meaning | Examples |
| ---- | ------- | -------- |
| **A** | Flagship liquidity / full size | VNL, Olympics, WC, CEV CL, SuperLega/PlusLiga-class, **NCAA DI women + Power 4 + tournament** |
| **B** | Strong but thinner | CEV Cup, KR V-League, elite beach, **NCAA men / beach** |
| **C** | Mid domestic / regional / DII–DIII | Vietnam, Argentina, **NCAA DII/DIII**, generic beach |
| **D** | Friendlies / obscure | Friendly International, Gambia national |

Tier is **operator sizing**, not a feed field. Prefer:

```ts
import {
  resolveCompetition,
  resolveVolleyballCompetitionTier,
} from '../src/domain/index.ts';

const hit = resolveCompetition({
  liveProduct: 'plive',
  sportId: 'volleyball',
  inventoryBucket: 'volleyball',
  league: "NCAA Women's Volleyball",
});
const tier = resolveVolleyballCompetitionTier({
  competitionId: hit?.competitionId,
  leagueKey: "NCAA Women's Volleyball",
});
// → 'A'
```

## NCAA seeds (pre-promote)

Seeded before first live sighting so inventory promote maps cleanly:

| Competition id | Primary leagueKey | Tier |
| -------------- | ----------------- | ---- |
| `volleyball.ncaa_women_s_volleyball` | NCAA Women's Volleyball | A |
| `volleyball.ncaa_women_s_volleyball_tournament` | NCAA Women's Volleyball Tournament | A |
| `volleyball.ncaa_big_ten_women` | NCAA Big Ten Women's Volleyball | A |
| `volleyball.ncaa_sec_women` | NCAA SEC Women's Volleyball | A |
| `volleyball.ncaa_acc_women` | NCAA ACC Women's Volleyball | A |
| `volleyball.ncaa_big_12_women` | NCAA Big 12 Women's Volleyball | A |
| `volleyball.ncaa_men_s_volleyball` | NCAA Men's Volleyball | B |
| `volleyball.ncaa_beach_volleyball` | NCAA Beach Volleyball | B |
| `volleyball.ncaa_dii_women` | NCAA DII Women's Volleyball | C |
| `volleyball.ncaa_diii_women` | NCAA DIII Women's Volleyball | C |

Aliases cover common variants (`College Volleyball`, `NCAA Volleyball`, conference short names, DI wording).

## Inventory

```bash
bun run inventory:leagues -- --unmapped   # look for volleyball / ncaa
bun run inventory:leagues -- --promote    # plan inserts (NCAA already seeded → already_mapped)
```

Coverage board (snapshot): volleyball had **4** live leagues / **3** mapped / **28** Pandora leagues — remaining unmapped should promote into A–D via `inferVolleyballTierFromLeagueLabel` when ids are new.

## Tests

```bash
bun test tests/domain/volleyball-tiers.test.ts
```
