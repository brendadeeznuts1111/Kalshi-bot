# Kalshi GitHub Bot Research Report

Run: `2026-07-22T06-19-51-053Z`
Dimension: `arbitrage` — Cross-venue arbitrage
Generated: 2026-07-22T06:19:51.053Z

[local browser](/) · [latest diff](latest-arbitrage.diff.md)

## Stats
- Discovered: 14
- Passed gate: 1
- Inspected: 1
- Shortlist: 1

## Shortlist

### 1. [RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot](https://github.com/RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot) · [local](/repo/RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot)

- Stars: 7 | Forks: 2
- License: gpl-3.0 (non-preferred)
- Stack: Python
- Strategy tags: market_making, arb, news_event
- Quality score: **69.5/100**
- Breakdown: auth 15, orders 25, tests 9, docs 15, maintenance 4, risk 4.5, license -3
- Last default-branch commit: 2025-12-12T08:01:02Z

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox.

- **auth-api** (15/25): KALSHI access headers in code; trade-api/v2
  - `KALSHI-ACCESS-KEY` → `app/clients/kalshi/base.py`
  - `KALSHI-ACCESS-KEY` → `shared_libraries/shared_infra_pkg/shared_infra/kalshi_clients/kalshi_base.py`
  - `KALSHI-ACCESS-KEY` → `shared_libraries/shared_infra_pkg/build/lib/shared_infra/kalshi_clients/kalshi_base.py`
  - `KALSHI-ACCESS-SIGNATURE` → `app/clients/kalshi/base.py`
  - `KALSHI-ACCESS-SIGNATURE` → `shared_libraries/shared_infra_pkg/shared_infra/kalshi_clients/kalshi_base.py`
- **order-realism** (25/25): live order path markers; dry-run / paper default
  - `create_order` → `app/clients/kalshi/kalshi_http_client.py`
  - `create_order` → `app/gateways/trade_gateway.py`
  - `create_order` → `shared_libraries/shared_infra_pkg/shared_infra/kalshi_clients/kalshi_http.py`
  - `create_order` → `shared_libraries/shared_infra_pkg/build/lib/shared_infra/kalshi_clients/kalshi_http.py`
  - `create_order` → `app/clients/polymarket/clob_http.py`
- **tests-ci** (9/15): test tree
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (4/10): last default-branch commit 2025-12-12T08:01:02Z
- **risk-controls** (4.5/10): risk limit
  - `risk limit` → `(readme/code aggregate)`

## Shortlist tag coverage

Per-tag cap: **4** (multi-tag repos count toward each tag).

| Tag | Count | Cap | At cap |
|-----|-------|-----|--------|
| arb | 1 | 4 | no |
| market_making | 1 | 4 | no |
| news_event | 1 | 4 | no |

## All scored repos

| Rank | Repo | Score | License | Tags |
|------|------|-------|---------|------|
| 1 | [RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot](/repo/RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot) | 69.5 | gpl-3.0 | market_making, arb, news_event |