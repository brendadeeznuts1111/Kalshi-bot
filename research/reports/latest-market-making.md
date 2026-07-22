# Kalshi GitHub Bot Research Report

Run: `2026-07-22T06-13-45-870Z`
Dimension: `market-making` — Market making / liquidity
Generated: 2026-07-22T06:13:45.870Z

[local browser](/) · [latest diff](latest-market-making.diff.md)

## Stats
- Discovered: 27
- Passed gate: 1
- Inspected: 1
- Shortlist: 1

## Shortlist

### 1. [rodlaf/KalshiMarketMaker](https://github.com/rodlaf/KalshiMarketMaker) · [local](/repo/rodlaf/KalshiMarketMaker)

- Stars: 223 | Forks: 60
- License: mit
- Stack: Python
- Strategy tags: market_making, news_event
- Quality score: **67.75/100**
- Breakdown: auth 21.25, orders 25, tests 9, docs 6, maintenance 6.5, risk 0, license -0
- Last default-branch commit: 2026-04-14T13:21:11Z
- Description: Deploy simple market making strategies on Kalshi

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox.

- **auth-api** (21.25/25): KALSHI access headers in code; trade-api/v2; official SDK markers
  - `KALSHI-ACCESS-SIGNATURE` → `kalshi_market_maker/core/kalshi_api.py`
- **order-realism** (25/25): live order path markers; dry-run / paper default
- **tests-ci** (9/15): test tree
- **docs-setup** (6/15): thin readme
- **maintenance** (6.5/10): last default-branch commit 2026-04-14T13:21:11Z

## Shortlist tag coverage

Per-tag cap: **4** (multi-tag repos count toward each tag).

| Tag | Count | Cap | At cap |
|-----|-------|-----|--------|
| market_making | 1 | 4 | no |
| news_event | 1 | 4 | no |

## All scored repos

| Rank | Repo | Score | License | Tags |
|------|------|-------|---------|------|
| 1 | [rodlaf/KalshiMarketMaker](/repo/rodlaf/KalshiMarketMaker) | 67.75 | mit | market_making, news_event |