# Hypothesis — tennis-game-model

> Archetype: **self-model**. No sharp consensus feed for Challenger/ITF. Edge = being the only number in the room — a calibrated game model vs Kalshi mid, fee-aware. Does **not** use The Odds API or any third-party odds compilation for `p_model`.

Doctrine: [`docs/TENNIS_PROGRAM_ARCHETYPES.md`](../../docs/TENNIS_PROGRAM_ARCHETYPES.md).

## 1. What is the edge, in one sentence?

_A point/game model priced against Kalshi Challenger/ITF (and ladder when present) after fees, where no Pinnacle/Odds-API reference exists — edge from better state estimation than recreational books._

## 2. Who is on the other side, and why are they willingly losing it to me?

_Recreational flow and favorite-longshot bias on low-info names (ITF/Challenger); they are not willingly losing to a sharp consensus because there isn't one on these markets — they are mispricing tails and mid-band relative to match state._

## 3. Why does this edge persist?

_Attention and data cost: ITF/Challenger lack liquid sharp books; Kalshi lists them anyway. Persistence lasts until a sharp reference arrives or our model fails calibration. Capacity is thin — depth at the underdog ask gates size._

## 4. What observation would falsify it?

_If mid-band (30–70¢) resolved Brier / log-loss is no better than the market mid itself over ≥ `graduationMinDistinctEvents`, or realized edge after fees ≤ 0 at pilot size, kill. Deep-tail favorites alone can never graduate (unverifiable)._

## 5. What's the capacity?

_Pilot lots sized to **vol24h and resting ask depth** on the underdog/mid leg — never lifetime volume. First tenants watch calendar `tradable` sort only._

## Scope gates

- **In:** `KXITF*`, Challenger match series; underdog + mid-band legs; full ladder when Kalshi lists it (ITF is winners-only today).
- **Out:** ATP/WTA named events with Odds API coverage — those are `tennis-tour-pinnacle-novig`.
- **Data:** primary-source results collector only (`corpus=trading` + provenance). Sackmann / tennis-data compilations stay `research-only` and never touch `p_model`.
- **Graduation:** realized edge ¢/fill **and** mid-band calibration vs market; no Odds API baseline. Higher event count than tour-racing because there is no external stick.

## References

- [`docs/TENNIS_PROGRAM_ARCHETYPES.md`](../../docs/TENNIS_PROGRAM_ARCHETYPES.md)
- Calendar: `bun run tennis:itf -- --sort=tradable`
