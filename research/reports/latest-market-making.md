# Kalshi GitHub Bot Research Report

Run: `2026-08-15T22-06-13-046Z`
Dimension: `market-making` — Market making / liquidity
Generated: 2026-08-15T22:06:13.046Z

[local browser](/) · [latest diff](latest-market-making.diff.md)

## Stats
- Discovered: 94
- Passed gate: 7
- Inspected: 7
- Shortlist: 4
- Cache: ETag 0, search stale 0, inspect exact 5, inspect reuse 0, inspect stale 0, api stale 0
- Timing: discover 5.4s, gate 1ms, inspect 146.1s, score 1ms (151.5s total)

> Discovery search uses relaxed gate (min-stars=0, min-forks=0, max-age-months=18); apply gate is stricter (min-stars=5, min-forks=3, max-age-months=18).

## Shortlist

### 1. [Razzleberryss/AstroTick](https://github.com/Razzleberryss/AstroTick) · [local](/repo/Razzleberryss/AstroTick)

- Stars: 16 | Forks: 2
- License: Apache-2.0
- Stack: Python
- Strategy tags: market_making, momentum
- Quality score: **89/100**
- Breakdown: auth 21.25, orders 21.25, tests 15, docs 15, maintenance 6.5, risk 10, license -0
- Last default-branch commit: 2026-05-14T05:28:34Z
- Description: 🚀 Trade Bitcoin prediction markets on autopilot with this automated Kalshi trading bot in Python — targets BTC Up/Down 15-minute contracts using momentum signals, orderbook skew, stop-loss/take-profit exits, and a live Flask dashboard, all powered by the official Kalshi REST API v2 with RSA-PSS authentication and 🦞OpenClaw🦞 integration 

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox. Tests + CI — lower integration risk when extracting.

- **auth-api** (21.25/25): KALSHI access headers in code; trade-api/v2; RSA-PSS signing; official SDK markers
  - `KALSHI-ACCESS-KEY` → `websocket_client.py`
  - `KALSHI-ACCESS-KEY` → `tests/test_websocket_orderbook.py`
  - `KALSHI-ACCESS-SIGNATURE` → `websocket_client.py`
  - `KALSHI-ACCESS-SIGNATURE` → `tests/test_websocket_orderbook.py`
  - `trade-api/v2` → `config.py`
- **order-realism** (21.25/25): live order path markers; dry-run / paper default; cent price bounds (1–99 / price_cents)
  - `create_order` → `kalshi_client.py`
  - `portfolio/orders` → `kalshi_client.py`
  - `/orders` → `kalshi_client.py`
  - `place_order` → `kalshi_client.py`
  - `place_order` → `kalshi_inprocess_orders.py`
- **tests-ci** (15/15): test tree; CI config
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (6.5/10): last default-branch commit 2026-05-14T05:28:34Z
- **risk-controls** (10/10): position size, stop_loss, risk limit
  - `position size` → `(readme/code aggregate)`
  - `stop_loss` → `(readme/code aggregate)`
  - `risk limit` → `(readme/code aggregate)`

### 2. [mbordash/DRADIS](https://github.com/mbordash/DRADIS) · [local](/repo/mbordash/DRADIS)

- Stars: 18 | Forks: 6
- License: AGPL-3.0 (non-preferred)
- Stack: Rust
- Strategy tags: market_making, arb, sports, news_event, momentum, llm_ensemble
- Quality score: **83.25/100**
- Breakdown: auth 25, orders 15, tests 15, docs 11.25, maintenance 10, risk 10, license -3
- Last default-branch commit: 2026-08-15T12:26:24Z
- Description: Low-latency Rust prediction-market trading bot for Kalshi & Polymarket. 9 autonomous strategies (Momentum, Maker, Arbitrage, ML, etc.), real-time Next.js Control Tower, and an AI LLM Advisor that delivers optimization recommendations via Ollama (local or remote) + Telegram and OpenClaw.

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Tests + CI — lower integration risk when extracting.

- **auth-api** (25/25): KALSHI access headers in code; trade-api/v2; RSA-PSS signing; auth freshness (recent commit + v2/PSS); official SDK markers
  - `KALSHI-ACCESS-KEY` → `src/venues/kalshi/auth.rs`
  - `KALSHI-ACCESS-SIGNATURE` → `src/venues/kalshi/auth.rs`
  - `trade-api/v2` → `src/venues/kalshi/mod.rs`
  - `trade-api/v2` → `src/venues/kalshi/auth.rs`
  - `RSA-PSS` → `README.md`
- **order-realism** (15/25): live order path markers; cent price bounds (1–99 / price_cents)
  - `create_order` → `src/venues/kalshi/types.rs`
  - `portfolio/orders` → `src/venues/kalshi/auth.rs`
  - `portfolio/orders` → `src/venues/kalshi/orders.rs`
  - `/orders` → `src/venues/intl/orders.rs`
  - `/orders` → `src/venues/kalshi/orders.rs`
- **tests-ci** (15/15): test tree; CI config
- **docs-setup** (11.25/15): setup section
- **maintenance** (10/10): last default-branch commit 2026-08-15T12:26:24Z
- **risk-controls** (10/10): kelly, stop loss, drawdown
  - `kelly` → `(readme/code aggregate)`
  - `stop loss` → `(readme/code aggregate)`
  - `drawdown` → `(readme/code aggregate)`

### 3. [kuestcom/prediction-market](https://github.com/kuestcom/prediction-market) · [local](/repo/kuestcom/prediction-market)

> **License warning:** No usable open-source license detected. Not safe to lift code.

- Stars: 1025 | Forks: 780
- License: **UNLICENSED**
- Stack: TypeScript
- Strategy tags: market_making, arb, sports, news_event
- Quality score: **51.5/100**
- Breakdown: auth 16.75, orders 18.75, tests 15, docs 6, maintenance 10, risk 0, license -15
- Last default-branch commit: 2026-08-15T13:22:31Z
- Description: Launch your own web3 decentralized prediction market in minutes (Polymarket like)

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Fee-aware edge math — aligns with Kalshi fee schedule. Tests + CI — lower integration risk when extracting.

- **auth-api** (16.75/25): KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS)
- **order-realism** (18.75/25): live order path markers; cent price bounds (1–99 / price_cents)
  - `create_order` → `docs/api-reference/clients-sdks.mdx`
  - `CreateOrder` → `src/lib/db/queries/order.ts`
  - `CreateOrder` → `src/lib/polymarket-orders-client.ts`
  - `CreateOrder` → `src/app/[locale]/(platform)/event/[slug]/_actions/store-order.ts`
  - `CreateOrder` → `docs/api-reference/schemas/openapi-clob.json`
- **fee-aware** (3.75/3.75): trading fee
  - `trading fee` → `(readme/code aggregate)`
- **tests-ci** (15/15): test tree; CI config
- **docs-setup** (6/15): thin readme
- **maintenance** (10/10): last default-branch commit 2026-08-15T13:22:31Z

### 4. [rodlaf/KalshiMarketMaker](https://github.com/rodlaf/KalshiMarketMaker) · [local](/repo/rodlaf/KalshiMarketMaker)

- Stars: 227 | Forks: 62
- License: MIT
- Stack: Python
- Strategy tags: market_making, news_event
- Quality score: **60.75/100**
- Breakdown: auth 18, orders 21.25, tests 9, docs 6, maintenance 6.5, risk 0, license -0
- Last default-branch commit: 2026-04-14T13:21:11Z
- Description: Deploy simple market making strategies on Kalshi

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox.

- **auth-api** (18/25): KALSHI access headers in code; trade-api/v2; official SDK markers
  - `KALSHI-ACCESS-SIGNATURE` → `kalshi_market_maker/core/kalshi_api.py`
- **order-realism** (21.25/25): live order path markers; dry-run / paper default; cent price bounds (1–99 / price_cents)
  - `price_cents` → `kalshi_market_maker/cli/cancel_all.py`
  - `yes_price` → `kalshi_market_maker/core/avellaneda.py`
  - `yes_price` → `kalshi_market_maker/core/kalshi_api.py`
  - `no_price` → `kalshi_market_maker/core/avellaneda.py`
  - `no_price` → `kalshi_market_maker/core/kalshi_api.py`
- **tests-ci** (9/15): test tree
- **docs-setup** (6/15): thin readme
- **maintenance** (6.5/10): last default-branch commit 2026-04-14T13:21:11Z

## Shortlist tag coverage

Per-tag cap: **4** (multi-tag repos count toward each tag).

| Tag | Count | Cap | At cap |
|-----|-------|-----|--------|
| market_making | 4 | 4 | yes |
| news_event | 3 | 4 | no |
| arb | 2 | 4 | no |
| momentum | 2 | 4 | no |
| sports | 2 | 4 | no |
| llm_ensemble | 1 | 4 | no |

## License alerts
- **kuestcom/prediction-market** — unlicensed

## All scored repos

| Rank | Repo | Score | License | Tags |
|------|------|-------|---------|------|
| 1 | [Razzleberryss/AstroTick](/repo/Razzleberryss/AstroTick) | 89 | Apache-2.0 | market_making, momentum |
| 2 | [mbordash/DRADIS](/repo/mbordash/DRADIS) | 83.25 | AGPL-3.0 | market_making, arb, sports, news_event, momentum, llm_ensemble |
| 3 | [rodlaf/KalshiMarketMaker](/repo/rodlaf/KalshiMarketMaker) | 60.75 | MIT | market_making, news_event |
| 4 | [guzus/dr-manhattan](/repo/guzus/dr-manhattan) | 55.25 | UNLICENSED | market_making, arb, sports, news_event, llm_ensemble |
| 5 | [else24/kalshi-market-bot](/repo/else24/kalshi-market-bot) | 55.25 | MIT | market_making, news_event, momentum, mean_reversion |
| 6 | [kuestcom/prediction-market](/repo/kuestcom/prediction-market) | 51.5 | UNLICENSED | market_making, arb, sports, news_event |
| 7 | [defi-ape/polymarket-kalshi-arbitrage-bot](/repo/defi-ape/polymarket-kalshi-arbitrage-bot) | 45.25 | UNLICENSED | market_making, arb, news_event |