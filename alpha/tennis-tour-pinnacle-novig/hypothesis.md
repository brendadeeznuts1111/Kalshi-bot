# Hypothesis — tennis-tour-pinnacle-novig

> Archetype: **tour sharp**. Edge = racing Pinnacle no-vig consensus on ATP/WTA named events that The Odds API covers. Same pattern as `pinnacle-novig-mlb` / `nba`. Does **not** watch Challenger/ITF.

Doctrine: [`docs/TENNIS_PROGRAM_ARCHETYPES.md`](../../docs/TENNIS_PROGRAM_ARCHETYPES.md).

## 1. What is the edge, in one sentence?

_Pinnacle no-vig vs Kalshi tour-match (and ladder) prices after fees — latency and attention gap vs recreational flow on named ATP/WTA events._

## 2. Who is on the other side, and why are they willingly losing it to me?

_Recreational and name-recognition flow on tour markets; sharp consensus exists and is measurable, so the other side is whoever is slower or less fee-aware than that consensus — not "the market is wrong."_

## 3. Why does this edge persist?

_Kalshi tour books thin relative to Pinnacle; fee drag and recreational clustering on favorites create temporary dislocations that a fee-aware gate can harvest when the novig lead is large enough._

## 4. What observation would falsify it?

_If realized edge after fees at `MIN_CONTRACTS` is consistently ≤ 0 across ≥ `graduationMinDistinctEvents` tour events while Pinnacle was available, the racing hypothesis fails (or capacity is illusory)._

## 5. What's the capacity?

_Pilot-sized: size off daily flow and resting depth at the target price on each ladder leg — not lifetime volume. Deep-tail favorites (90¢+) are out of scope; mid-band and underdog legs only when depth supports the lot size._

## Scope gates

- **In:** Odds API tennis keys for named ATP/WTA tournaments; Kalshi `KXATPMATCH` / `KXWTAMATCH` + open ladder siblings sharing the matchup blob.
- **Out:** Challenger, ITF, exhibitions without a sharp book — those belong to `tennis-game-model`.
- **Graduation:** realized edge ¢/fill after fees (primary); Brier vs Pinnacle as sanity only. Baseline-measurable.

## References

- Odds API sports catalog — ATP/WTA named events only (no Challenger/ITF keys)
- [`docs/TENNIS_PROGRAM_ARCHETYPES.md`](../../docs/TENNIS_PROGRAM_ARCHETYPES.md)
