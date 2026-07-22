# Kalshi GitHub Bot Research Report

Run: `2026-07-22T06-34-31-618Z`
Dimension: `wallet-track` — Wallet / balance tracking
Generated: 2026-07-22T06:34:31.618Z

[local browser](/) · [latest diff](latest-wallet-track.diff.md)

## Stats
- Discovered: 1
- Passed gate: 1
- Inspected: 1
- Shortlist: 1

## Shortlist

### 1. [bullmeme777/kalshi-portfolio-tracker](https://github.com/bullmeme777/kalshi-portfolio-tracker) · [local](/repo/bullmeme777/kalshi-portfolio-tracker)

> **License warning:** No usable open-source license detected. Not safe to lift code.

- Stars: 0 | Forks: 0
- License: **UNLICENSED**
- Stack: Python
- Strategy tags: sports, llm_ensemble
- Quality score: **47.75/100**
- Breakdown: auth 21.75, orders 17.5, tests 0, docs 15, maintenance 8.5, risk 0, license -15
- Last default-branch commit: 2026-04-24T06:11:31Z
- Description: Portfolio tracker and analytics dashboard for Kalshi accounts. Monitors open positions, P&L, win rate, exposure by category, and resolution history across your entire Kalshi portfolio.

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Missing test coverage on extracted paths.

- **auth-api** (21.75/25): KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS); official SDK markers
- **order-realism** (17.5/25): live order path markers; cent price bounds (1–99 / price_cents)
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (8.5/10): last default-branch commit 2026-04-24T06:11:31Z

## Shortlist tag coverage

Per-tag cap: **4** (multi-tag repos count toward each tag).

| Tag | Count | Cap | At cap |
|-----|-------|-----|--------|
| llm_ensemble | 1 | 4 | no |
| sports | 1 | 4 | no |

## License alerts
- **bullmeme777/kalshi-portfolio-tracker** — unlicensed

## All scored repos

| Rank | Repo | Score | License | Tags |
|------|------|-------|---------|------|
| 1 | [bullmeme777/kalshi-portfolio-tracker](/repo/bullmeme777/kalshi-portfolio-tracker) | 47.75 | UNLICENSED | sports, llm_ensemble |