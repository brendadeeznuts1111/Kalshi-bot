# Hypothesis — pinnacle-novig-mlb (baseline measuring stick, July–Sep)

> Live shadow clock while NBA is off-season. Kalshi series: **KXMLBGAME** (verified open markets July 2026).

## 1. What is the edge, in one sentence?

_No proprietary edge — Pinnacle no-vig vs Kalshi price after fees on live MLB game markets._

## 2. Who is on the other side?

_N/A — baseline measures divergence from sharp consensus, not counterparty identity._

## 3. Why does this edge persist?

_N/A — records frequency and magnitude for future alpha programs to beat._

## 4. What observation would falsify it?

_If novig minus Kalshi converges such that realized edge after fees is consistently negative at MIN_CONTRACTS, the stick still holds — it proves no structural gap._

## 5. What's the capacity?

_Shadow-only observation. `role=baseline` — watcher never graduates this program._

## Ticker notes

- Format: `KXMLBGAME-{date}{time}{teams}-{YES_TEAM}` — YES pays if suffix team wins.
- Odds API sport key: `baseball_mlb`.
- Overrides: [`research/ticker-overrides.json`](../../research/ticker-overrides.json) until auto-map proves stable.
