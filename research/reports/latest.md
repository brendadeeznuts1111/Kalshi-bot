# Kalshi GitHub Bot Research Report

Run: `2026-07-22T04-59-00-818Z`
Generated: 2026-07-22T04:59:00.818Z

[local browser](/) · [latest diff](latest.diff.md)

## Stats
- Discovered: 100
- Passed gate: 15
- Inspected: 15
- Shortlist: 6

## Shortlist

### 1. [OctagonAI/kalshi-trading-bot-cli](https://github.com/OctagonAI/kalshi-trading-bot-cli) · [local](/repo/OctagonAI/kalshi-trading-bot-cli)

- Stars: 355 | Forks: 94
- License: MIT License
- Stack: TypeScript
- Strategy tags: market_making, sports, news_event, momentum, llm_ensemble
- Quality score: **84.75/100**
- Breakdown: auth 21.25, orders 25, tests 6, docs 15, maintenance 10, risk 7.5, license -0
- Last default-branch commit: 2026-06-25T21:39:46Z
- Description: AI-native CLI for trading Kalshi prediction markets. Runs deep fundamental research, generates independent probability estimates, computes edge vs. live order books, and executes trades with Kelly sizing and a 5-gate risk engine. 

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox. Missing test coverage on extracted paths.

- **auth-api** (21.25/25): KALSHI access headers in code; trade-api/v2; official SDK markers
  - `kalshi_api` → `env.example`
  - `kalshi_api` → `src/commands/status.ts`
  - `kalshi_api` → `src/setup/wizard.ts`
  - `kalshi_api` → `GUIDE.md`
  - `kalshi_api` → `README.md`
- **order-realism** (25/25): live order path markers; dry-run / paper default
  - `dry-run` → `README.md`
  - `dry-run` → `src/commands/help.ts`
  - `dry-run` → `src/commands/parse-args.ts`
- **tests-ci** (6/15): CI config
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (10/10): last default-branch commit 2026-06-25T21:39:46Z
- **risk-controls** (7.5/10): kelly, drawdown
  - `kelly` → `(readme/code aggregate)`
  - `drawdown` → `(readme/code aggregate)`

### 2. [antmlap/kalshi-arbitrage-bot](https://github.com/antmlap/kalshi-arbitrage-bot) · [local](/repo/antmlap/kalshi-arbitrage-bot)

- Stars: 7 | Forks: 3
- License: MIT License
- Stack: Python
- Strategy tags: market_making, arb, news_event
- Quality score: **62.75/100**
- Breakdown: auth 21.25, orders 15, tests 0, docs 15, maintenance 4, risk 7.5, license -0
- Last default-branch commit: 2025-11-17T19:04:57Z

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Missing test coverage on extracted paths.

- **auth-api** (21.25/25): KALSHI access headers in code; trade-api/v2; official SDK markers
- **order-realism** (15/25): live order path markers
  - `portfolio/orders` → `kalshi_client.py`
  - `/orders` → `kalshi_client.py`
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (4/10): last default-branch commit 2025-11-17T19:04:57Z
- **risk-controls** (7.5/10): position size, position_size
  - `position size` → `(readme/code aggregate)`
  - `position_size` → `(readme/code aggregate)`

### 3. [Drakkar-Softwares/polymarket-kalshi-arbitrage-bot](https://github.com/Drakkar-Softwares/polymarket-kalshi-arbitrage-bot) · [local](/repo/Drakkar-Softwares/polymarket-kalshi-arbitrage-bot)

> **License warning:** No usable open-source license detected. Not safe to lift code.

- Stars: 24 | Forks: 290
- License: **UNLICENSED**
- Stack: TypeScript
- Strategy tags: market_making, arb, sports, news_event
- Quality score: **44.75/100**
- Breakdown: auth 21.25, orders 15, tests 0, docs 15, maintenance 8.5, risk 0, license -15
- Last default-branch commit: 2026-05-11T07:57:41Z
- Description:  polymarket trading bot, polymarket bot, polymarket kalshi trading bot,polymarket trading bot, polymarket bot, polymarket kalshi trading bot,polymarket trading bot, polymarket bot, polymarket kalshi trading bot,polymarket trading bot, polymarket bot, polymarket kalshi trading bot,polymarket trading bot, polymarket bot, polymarket kalshi trading bot

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Missing test coverage on extracted paths.

- **auth-api** (21.25/25): KALSHI access headers in code; trade-api/v2; official SDK markers
- **order-realism** (15/25): live order path markers
- **docs-setup** (15/15): setup section; strategy section
- **maintenance** (8.5/10): last default-branch commit 2026-05-11T07:57:41Z

### 4. [openfi-dao/kalshi-trading-bot](https://github.com/openfi-dao/kalshi-trading-bot) · [local](/repo/openfi-dao/kalshi-trading-bot)

> **License warning:** No usable open-source license detected. Not safe to lift code.

- Stars: 7 | Forks: 319
- License: **UNLICENSED**
- Stack: TypeScript
- Strategy tags: news_event, llm_ensemble
- Quality score: **67.5/100**
- Breakdown: auth 21.25, orders 25, tests 9, docs 11.25, maintenance 8.5, risk 7.5, license -15
- Last default-branch commit: 2026-05-07T11:42:13Z
- Description: kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot kalshi trading bot

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox.

- **auth-api** (21.25/25): KALSHI access headers in code; trade-api/v2; official SDK markers
- **order-realism** (25/25): live order path markers; dry-run / paper default
- **tests-ci** (9/15): test tree
- **docs-setup** (11.25/15): setup section
- **maintenance** (8.5/10): last default-branch commit 2026-05-07T11:42:13Z
- **risk-controls** (7.5/10): kelly, risk limit
  - `kelly` → `(readme/code aggregate)`
  - `risk limit` → `(readme/code aggregate)`

### 5. [scripflipped/Krypt-Trader](https://github.com/scripflipped/Krypt-Trader) · [local](/repo/scripflipped/Krypt-Trader)

- Stars: 143 | Forks: 37
- License: MIT License
- Stack: Python
- Strategy tags: momentum
- Quality score: **62/100**
- Breakdown: auth 15, orders 25, tests 6, docs 6, maintenance 10, risk 0, license -0
- Last default-branch commit: 2026-07-13T00:41:42Z
- Description: A free Kalshi Trading bot - fully customizable

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox. Missing test coverage on extracted paths.

- **auth-api** (15/25): KALSHI access headers in code; trade-api/v2
- **order-realism** (25/25): live order path markers; dry-run / paper default
- **tests-ci** (6/15): CI config
- **docs-setup** (6/15): thin readme
- **maintenance** (10/10): last default-branch commit 2026-07-13T00:41:42Z

### 6. [ImMike/polymarket-arbitrage](https://github.com/ImMike/polymarket-arbitrage) · [local](/repo/ImMike/polymarket-arbitrage)

> **License warning:** No usable open-source license detected. Not safe to lift code.

- Stars: 228 | Forks: 111
- License: **UNLICENSED**
- Stack: Python
- Strategy tags: market_making, arb
- Quality score: **53.75/100**
- Breakdown: auth 15, orders 25, tests 9, docs 11.25, maintenance 4, risk 4.5, license -15
- Last default-branch commit: 2025-12-09T05:50:19Z
- Description: A Polymarket and Kalshi Arbitrage bot written in Python, watches 10,000+ markets looking for inefficient markets on and between platforms

#### Evidence & lift

> Auth + order paths present — candidate for lifting signing and execution modules separately. Dry-run default detected — safe to sandbox.

- **auth-api** (15/25): KALSHI access headers in code; trade-api/v2
- **order-realism** (25/25): live order path markers; dry-run / paper default
  - `dry_run` → `main.py`
  - `dry_run` → `utils/config_loader.py`
  - `dry_run` → `README.md`
  - `dry_run` → `kalshi_client/api.py`
  - `dry_run` → `config.yaml`
- **tests-ci** (9/15): test tree
- **docs-setup** (11.25/15): setup section
- **maintenance** (4/10): last default-branch commit 2025-12-09T05:50:19Z
- **risk-controls** (4.5/10): risk limit
  - `risk limit` → `(readme/code aggregate)`

## Shortlist tag coverage

Per-tag cap: **4** (multi-tag repos count toward each tag).

| Tag | Count | Cap | At cap |
|-----|-------|-----|--------|
| market_making | 4 | 4 | yes |
| news_event | 4 | 4 | yes |
| arb | 3 | 4 | no |
| llm_ensemble | 2 | 4 | no |
| momentum | 2 | 4 | no |
| sports | 2 | 4 | no |

## License alerts
- **Drakkar-Softwares/polymarket-kalshi-arbitrage-bot** — unlicensed
- **openfi-dao/kalshi-trading-bot** — unlicensed
- **ImMike/polymarket-arbitrage** — unlicensed

## All scored repos

| Rank | Repo | Score | License | Tags |
|------|------|-------|---------|------|
| 1 | [OctagonAI/kalshi-trading-bot-cli](/repo/OctagonAI/kalshi-trading-bot-cli) | 84.75 | ? | market_making, sports, news_event, momentum, llm_ensemble |
| 2 | [rodlaf/KalshiMarketMaker](/repo/rodlaf/KalshiMarketMaker) | 67.75 | ? | market_making, news_event |
| 3 | [openfi-dao/kalshi-trading-bot](/repo/openfi-dao/kalshi-trading-bot) | 67.5 | UNLICENSED | news_event, llm_ensemble |
| 4 | [gelatotrade/Polymarket-Kalshi-Arbitrage](/repo/gelatotrade/Polymarket-Kalshi-Arbitrage) | 67.5 | UNLICENSED | market_making, arb, news_event |
| 5 | [LoQiseaking69/kalshi-trading-bot](/repo/LoQiseaking69/kalshi-trading-bot) | 66.75 | UNLICENSED | arb, news_event, momentum, mean_reversion |
| 6 | [antmlap/kalshi-arbitrage-bot](/repo/antmlap/kalshi-arbitrage-bot) | 62.75 | ? | market_making, arb, news_event |
| 7 | [scripflipped/Krypt-Trader](/repo/scripflipped/Krypt-Trader) | 62 | ? | momentum |
| 8 | [TopTrenDev/polymarket-kalshi-arbitrage-bot](/repo/TopTrenDev/polymarket-kalshi-arbitrage-bot) | 58.5 | UNLICENSED | market_making, arb, news_event, momentum |
| 9 | [ImMike/polymarket-arbitrage](/repo/ImMike/polymarket-arbitrage) | 53.75 | UNLICENSED | market_making, arb |
| 10 | [pedronaldocr07/kalshi-trading-bot](/repo/pedronaldocr07/kalshi-trading-bot) | 51 | UNLICENSED | news_event |
| 11 | [Drakkar-Softwares/polymarket-kalshi-arbitrage-bot](/repo/Drakkar-Softwares/polymarket-kalshi-arbitrage-bot) | 44.75 | UNLICENSED | market_making, arb, sports, news_event |
| 12 | [Longbridges/polymarket-kalshi-arbitrage-bot](/repo/Longbridges/polymarket-kalshi-arbitrage-bot) | 44.75 | UNLICENSED | market_making, arb, news_event |
| 13 | [jelllott/polymarket-kalshi-arbitrage-bot](/repo/jelllott/polymarket-kalshi-arbitrage-bot) | 44.75 | UNLICENSED | market_making, arb, news_event |
| 14 | [defi-ape/polymarket-kalshi-arbitrage-bot](/repo/defi-ape/polymarket-kalshi-arbitrage-bot) | 44.75 | UNLICENSED | market_making, arb, news_event |
| 15 | [kalkiai-trade/kalshi-trading-bot](/repo/kalkiai-trade/kalshi-trading-bot) | 41 | UNLICENSED | news_event |