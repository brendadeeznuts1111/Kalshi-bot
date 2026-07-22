# Kalshi GitHub Bot Research Report

Run: `2026-07-22T06-34-52-547Z`
Dimension: `tracking` — Portfolio tracking / monitoring
Generated: 2026-07-22T06:34:52.547Z

[local browser](/) · [latest diff](latest-tracking.diff.md)

## Stats
- Discovered: 3
- Passed gate: 3
- Inspected: 3
- Shortlist: 3

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

### 2. [kevinhjshim/kalshi-pnl](https://github.com/kevinhjshim/kalshi-pnl) · [local](/repo/kevinhjshim/kalshi-pnl)

> **License warning:** No usable open-source license detected. Not safe to lift code.

- Stars: 0 | Forks: 0
- License: **UNLICENSED**
- Stack: Python
- Strategy tags: news_event
- Quality score: **27.75/100**
- Breakdown: auth 16.75, orders 17.5, tests 0, docs 0, maintenance 8.5, risk 0, license -15
- Last default-branch commit: 2026-05-20T22:18:35Z

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Missing test coverage on extracted paths.

- **auth-api** (16.75/25): KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS)
- **order-realism** (17.5/25): live order path markers; cent price bounds (1–99 / price_cents)
- **maintenance** (8.5/10): last default-branch commit 2026-05-20T22:18:35Z

### 3. [slee8495/kalshi-pnl-dashboard](https://github.com/slee8495/kalshi-pnl-dashboard) · [local](/repo/slee8495/kalshi-pnl-dashboard)

> **License warning:** No usable open-source license detected. Not safe to lift code.

- Stars: 0 | Forks: 0
- License: **UNLICENSED**
- Stack: HTML
- Strategy tags: news_event
- Quality score: **29.25/100**
- Breakdown: auth 16.75, orders 17.5, tests 0, docs 0, maintenance 10, risk 0, license -15
- Last default-branch commit: 2026-07-22T06:30:13Z

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Missing test coverage on extracted paths.

- **auth-api** (16.75/25): KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS)
- **order-realism** (17.5/25): live order path markers; cent price bounds (1–99 / price_cents)
- **maintenance** (10/10): last default-branch commit 2026-07-22T06:30:13Z

## Shortlist tag coverage

Per-tag cap: **4** (multi-tag repos count toward each tag).

| Tag | Count | Cap | At cap |
|-----|-------|-----|--------|
| news_event | 2 | 4 | no |
| llm_ensemble | 1 | 4 | no |
| sports | 1 | 4 | no |

## License alerts
- **bullmeme777/kalshi-portfolio-tracker** — unlicensed
- **kevinhjshim/kalshi-pnl** — unlicensed
- **slee8495/kalshi-pnl-dashboard** — unlicensed

## All scored repos

| Rank | Repo | Score | License | Tags |
|------|------|-------|---------|------|
| 1 | [bullmeme777/kalshi-portfolio-tracker](/repo/bullmeme777/kalshi-portfolio-tracker) | 47.75 | UNLICENSED | sports, llm_ensemble |
| 2 | [slee8495/kalshi-pnl-dashboard](/repo/slee8495/kalshi-pnl-dashboard) | 29.25 | UNLICENSED | news_event |
| 3 | [kevinhjshim/kalshi-pnl](/repo/kevinhjshim/kalshi-pnl) | 27.75 | UNLICENSED | news_event |