# Hypothesis — pinnacle-novig-nba (baseline measuring stick)

> This program IS the baseline. It does not graduate. It retires the 0.25 stub.

## 1. What is the edge, in one sentence?

_There is no proprietary edge claim — only Pinnacle no-vig consensus vs Kalshi price after fees._

## 2. Who is on the other side, and why are they willingly losing it to me?

_N/A for baseline — this program measures whether Kalshi diverges from sharp consensus, not who we beat._

## 3. Why does this edge persist?

_N/A — baseline records divergence frequency and magnitude for other programs to beat._

## 4. What observation would falsify it?

_If Pinnacle novig and Kalshi prices converge such that realized edge after fees is consistently negative at MIN_CONTRACTS, the measuring stick still holds — it proves there is no structural gap to harvest._

## 5. What's the capacity?

_Shadow-only, unbounded observation. role=baseline in program.json — watcher never emits graduation proposals._

## Role

- **Unit of account:** every future program's evidence includes "beats pinnacle-novig by X"
- **Stub killer:** empirical `baselineBrierScore()` from this log replaces DEFAULT_BASELINE_BRIER = 0.25
- **Plumbing test:** simplest signal (fetch → map → compare); failures are unambiguously pipeline bugs
