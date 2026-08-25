# Kalshi GitHub Bot Research Report

Run: `2026-08-25T16-52-57-644Z`
Dimension: `sports-nba` — NBA
Generated: 2026-08-25T16:52:57.644Z

[local browser](/) · [latest diff](latest-sports-nba.diff.md)

## Stats
- Discovered: 100
- Passed gate: 14
- Inspected: 14
- Shortlist: 4
- Cache: ETag 0, search stale 0, inspect exact 12, inspect reuse 0, inspect stale 0, api stale 0
- Timing: discover 6.3s, gate 8ms, inspect 64.0s, score 0ms (70.3s total)

> Discovery search uses relaxed gate (min-stars=0, min-forks=0, max-age-months=18); apply gate is stricter (min-stars=5, min-forks=3, max-age-months=18).

## Shortlist

### 1. [poly-copy-trading/polymarket-copy-trading-bot-weather-sports](https://github.com/poly-copy-trading/polymarket-copy-trading-bot-weather-sports) · [local](/repo/poly-copy-trading/polymarket-copy-trading-bot-weather-sports)

- Stars: 18 | Forks: 112
- License: MIT
- Stack: TypeScript
- Strategy tags: market_making, arb, sports, news_event, llm_ensemble
- Quality score: **78/100**
- Breakdown: auth 16.75, orders 21.25, tests 15, docs 15, maintenance 10, risk 0, license -0
- Last default-branch commit: 2026-08-20T07:11:05Z
- Description: polymarket-copy-trading-bot-weather-sports — Polymarket Copy Trading Bot Weather Sports. polymarket-copy-trading-bot-weather-sports is an open-source polymarket copy trading bot weather sports. Find polymarket-copy-trading-bot-weather-sports, polymarket copy trading bot weather sports, polymarket copy trading bot weather sports.

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox. Tests + CI — lower integration risk when extracting.

- **auth-api** (16.75/25): KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS)
- **order-realism** (21.25/25): live order path markers; dry-run / paper default; cent price bounds (1–99 / price_cents)
- **tests-ci** (15/15): test tree; CI config
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (10/10): last default-branch commit 2026-08-20T07:11:05Z

### 2. [declansx/sports-prediction-market-aggregator](https://github.com/declansx/sports-prediction-market-aggregator) · [local](/repo/declansx/sports-prediction-market-aggregator)

- Stars: 9 | Forks: 5
- License: MIT
- Stack: TypeScript
- Strategy tags: market_making, arb, sports, news_event, llm_ensemble
- Quality score: **64.25/100**
- Breakdown: auth 16.75, orders 15, tests 9, docs 15, maintenance 8.5, risk 0, license -0
- Last default-branch commit: 2026-06-15T14:34:31Z
- Description: Aggregator and smart order router for sports prediction markets. Fetches real-time odds and liquidity from SX Bet and Polymarket and routes your trade to the best odds at execution. Telegram bot + web dashboard.

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately.

- **auth-api** (16.75/25): KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS)
- **order-realism** (15/25): live order path markers; cent price bounds (1–99 / price_cents)
  - `/orders` → `CLAUDE.md`
  - `/orders` → `.claude/sxbet/signing.md`
  - `/orders` → `.claude/sxbet/realtime.md`
  - `/orders` → `.claude/sxbet/networks.md`
  - `/orders` → `bot/scripts/probeOrderCancel.ts`
- **tests-ci** (9/15): test tree
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (8.5/10): last default-branch commit 2026-06-15T14:34:31Z

### 3. [kachence/polymm](https://github.com/kachence/polymm) · [local](/repo/kachence/polymm)

- Stars: 80 | Forks: 31
- License: MIT
- Stack: Python
- Strategy tags: market_making, arb, sports, news_event
- Quality score: **60.5/100**
- Breakdown: auth 16.75, orders 15, tests 9, docs 9.75, maintenance 10, risk 0, license -0
- Last default-branch commit: 2026-08-16T18:42:07Z
- Description: A Polymarket sports market-making / arbitrage bot in Python - de-vig sportsbook odds, quote, hedge. The retired code behind a public $5k wallet.

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately.

- **auth-api** (16.75/25): KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS)
- **order-realism** (15/25): live order path markers; cent price bounds (1–99 / price_cents)
  - `create_order` → `src/execution/order_executor.py`
  - `create_order` → `tests/test_order_executor.py`
  - `/orders` → `src/state/match_state.py`
  - `/orders` → `src/state/order_state.py`
  - `/orders` → `tests/test_bot_state.py`
- **tests-ci** (9/15): test tree
- **docs-setup** (9.75/15): strategy section
- **maintenance** (10/10): last default-branch commit 2026-08-16T18:42:07Z

### 4. [sarviinageelen/polymarket-sports-analysis](https://github.com/sarviinageelen/polymarket-sports-analysis) · [local](/repo/sarviinageelen/polymarket-sports-analysis)

- Stars: 11 | Forks: 3
- License: MIT
- Stack: Python
- Strategy tags: market_making, arb, sports, news_event, llm_ensemble
- Quality score: **56/100**
- Breakdown: auth 13, orders 15, tests 9, docs 15, maintenance 4, risk 0, license -0
- Last default-branch commit: 2026-02-18T00:40:30Z
- Description: Analytics for Polymarket sports prediction markets. Tracks P&L, generates leaderboards, and identifies top forecasters across NFL, NBA, CFB, and CBB.

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately.

- **auth-api** (13/25): KALSHI access headers in code; trade-api/v2
- **order-realism** (15/25): live order path markers; cent price bounds (1–99 / price_cents)
  - `yes_price` → `update_trades.py`
  - `no_price` → `update_trades.py`
- **tests-ci** (9/15): test tree
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (4/10): last default-branch commit 2026-02-18T00:40:30Z

## Shortlist tag coverage

Per-tag cap: **4** (multi-tag repos count toward each tag).

| Tag | Count | Cap | At cap |
|-----|-------|-----|--------|
| arb | 4 | 4 | yes |
| market_making | 4 | 4 | yes |
| news_event | 4 | 4 | yes |
| sports | 4 | 4 | yes |
| llm_ensemble | 3 | 4 | no |

## All scored repos

| Rank | Repo | Score | License | Tags |
|------|------|-------|---------|------|
| 1 | [poly-copy-trading/polymarket-copy-trading-bot-weather-sports](/repo/poly-copy-trading/polymarket-copy-trading-bot-weather-sports) | 78 | MIT | market_making, arb, sports, news_event, llm_ensemble |
| 2 | [declansx/sports-prediction-market-aggregator](/repo/declansx/sports-prediction-market-aggregator) | 64.25 | MIT | market_making, arb, sports, news_event, llm_ensemble |
| 3 | [kachence/polymm](/repo/kachence/polymm) | 60.5 | MIT | market_making, arb, sports, news_event |
| 4 | [sterlingcrispin/nothing-ever-happens](/repo/sterlingcrispin/nothing-ever-happens) | 58 | CC0-1.0 | arb, sports |
| 5 | [sarviinageelen/polymarket-sports-analysis](/repo/sarviinageelen/polymarket-sports-analysis) | 56 | MIT | market_making, arb, sports, news_event, llm_ensemble |
| 6 | [chrisgillam/polymarket_gambot](/repo/chrisgillam/polymarket_gambot) | 52.75 | MIT | market_making, arb, sports, news_event |
| 7 | [cryptomoonday/polymarket-arbitrage-bot](/repo/cryptomoonday/polymarket-arbitrage-bot) | 50 | UNLICENSED | market_making, arb, sports, news_event, llm_ensemble |
| 8 | [asdgahw3/opayurfslreolk](/repo/asdgahw3/opayurfslreolk) | 47.5 | UNLICENSED | arb |
| 9 | [rustyneuron01/Polymarket-Sports-Trading-Bot](/repo/rustyneuron01/Polymarket-Sports-Trading-Bot) | 45.25 | UNLICENSED | arb, sports, news_event |
| 10 | [huachu-pets/polymarket-sports-copy-trading-bot](/repo/huachu-pets/polymarket-sports-copy-trading-bot) | 39 | UNLICENSED | arb, sports |
| 11 | [yangyuan-zhen/polysniper](/repo/yangyuan-zhen/polysniper) | 38.75 | UNLICENSED | arb, sports, news_event, mean_reversion |
| 12 | [abudnick8/prop-edge](/repo/abudnick8/prop-edge) | 32.75 | UNLICENSED | news_event |
| 13 | [huberco/polymarket-sports-trading-bot](/repo/huberco/polymarket-sports-trading-bot) | 30.75 | UNLICENSED | arb |
| 14 | [edge-smart/Rust-Politics-Sports-Polymarket-Trading-Bot](/repo/edge-smart/Rust-Politics-Sports-Polymarket-Trading-Bot) | 30.75 | UNLICENSED | arb, sports, news_event |