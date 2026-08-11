# Edge patterns (sport-wide eyes-open surface)

**Status:** code SSOT in [`src/settlement/edge-patterns.ts`](../src/settlement/edge-patterns.ts).  
**Goal:** converge on **types of pattern edges** — not one-off sport ifs — so the desk and models see the same mechanisms across sports, markets, and lines.

Settlement rules ([`PLIVE-EZLIVE-SPORTS-RULES.md`](PLIVE-EZLIVE-SPORTS-RULES.md)) feed **void/action** and period flags. Patterns sit **on top**: they fire when sport × market class × phase × line kind match a reusable mechanism.

## Dimensions

| Dimension | Examples | Role |
| --------- | -------- | ---- |
| **Sport** | tennis, soccer, baseball, … | Shell cards, OT minutes, 85′ abandon |
| **Market class** | match_ml, total, set_market, game_market, … | Pandora marketType → class |
| **Line kind** | moneyline, spread, total, prop, outright | Orthogonal product shape |
| **Phase** | prematch / live | Action threshold flips |
| **Match state** | set complete, injury, eligibility, minute | Instantiates void / elig hits |

New edges should prefer **new pattern ids in an existing family** over a bespoke sport branch.

## Families (convergent types)

| Family | Mechanism | Eyes open to… |
| ------ | --------- | ------------- |
| `void_action` | Refund / no-action vs win-lose binary | Retirement, abandon, rain, unfinished live ML |
| `phase_split` | Prematch ≠ live product | Pooling calibration without phase tags |
| `period_definition` | OT / ET / SO / extras inclusion | Q4 vs game totals, hockey 2-way vs 3-way |
| `line_unit` | Points vs games vs goals vs sets | TT points, TB=1 game |
| `participant_eligibility` | Must start / listed / tee-off / must-play | Pitcher scratch, inactive props |
| `interrupt_window` | Same-day / 24h / 72h resume | Hold vs cancel after delay |
| `fill_friction` | Secondary confirm, scoreboard guide | Soft live fills (esp. TT) |
| `already_determined` | Locked outcome stands on abandon | Over already cashed |
| `dead_heat` | Multiway pro-rata | Outrights / top-N |
| `cross_product` | plive ≡ ezlive | No product arb |

Catalog (runtime):

```bash
bun live-tracker.ts patterns
bun live-tracker.ts patterns --json
bun live-tracker.ts patterns --sort-by family,id
bun live-tracker.ts patterns --sort-by id --desc
```

### `--sort-by` (patterns / analyze --sport)

| Field | Catalog (`patterns`) | Hits (`analyze --sport`) |
| ----- | -------------------- | ------------------------ |
| `family` | Group / order by family | Order hits by family name |
| `severity` | No-op on definitions (falls to id) | Critical → info (default first key) |
| `id` | Flat list by pattern id | Order by `patternId` |

Comma-separated; left → right. `--desc` reverses. Defaults: catalog `family,id` · hits `severity,id`.
## Scan API

```ts
import { scanEdgePatterns, weightLiveTrackerMove } from '../src/settlement/index.ts';

const scan = scanEdgePatterns({
  sportId: 'tennis',
  phase: 'live',
  marketType: '3',
  period: 'm',
  matchState: { matchCompleted: false, injuryRisk: true },
});
// scan.hits ranked by severity; scan.eyeOpeners for desk
// scan.components → shadow / SignalContext

const move = weightLiveTrackerMove({
  sportId: 'baseball',
  phase: 'prematch',
  marketType: '3',
  period: 'm',
  decimalOdds: 1.91,
});
// move.patterns + move.voidEv + move.sizingNote
```

Live-tracker:

```bash
bun live-tracker.ts analyze --sport=tennis --phase=live
bun live-tracker.ts analyze --sport=tennis --phase=live --verbose  # include info hits
```

Signals:

```ts
buildPinnacleSignalContext({
  …,
  settlement: {
    sportId: 'tennis',
    phase: 'live',
    marketType: '3',
    period: 'm',
    matchState: { injuryRisk: true },
  },
});
// components.pat_* + settlement_*
```

## Adding a pattern

1. Pick a **family** (or propose a new family only if the mechanism is new).
2. Define `id` = `family.slug` (kebab).
3. Set **scope** (sports / marketClasses / phases / lineKinds) — use `*` when sport-wide.
4. `evaluate` returns `null` or a hit with severity + note + components.
5. Add a test in `tests/settlement/edge-patterns.test.ts`.
6. Document one line under the family in this file if the title is non-obvious.

**Do not** special-case “tennis only” if the same void/period/elig logic applies elsewhere — scope sports to the list that shares the mechanism.

## Severity guide

| Severity | Meaning |
| -------- | ------- |
| `info` | Always-on reminder (scoreboard guide, same-day interrupt) |
| `watch` | Model/desk should tag or filter |
| `high` | Likely mis-sized without this pattern (live unfinished ML, OT mismatch) |
| `critical` | Injury + void, eligibility broken — three-way / void outcome required |

## Related

| Doc / code | Role |
| ---------- | ---- |
| [`PLIVE-EZLIVE-SPORTS-RULES.md`](PLIVE-EZLIVE-SPORTS-RULES.md) | Shell settlement SSOT |
| [`src/settlement/weighting.ts`](../src/settlement/weighting.ts) | Action thresholds by sport |
| [`src/settlement/void-ev.ts`](../src/settlement/void-ev.ts) | Three-way EV |
| [`src/domain/odds-selection.ts`](../src/domain/odds-selection.ts) | Market type / period labels |
| Research `agent patterns` | **GitHub bot** patterns (different plane) |
