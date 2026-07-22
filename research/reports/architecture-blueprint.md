# Kalshi bot architecture blueprint

Generated: 2026-07-22T09:03:02.405Z

Single reference for **what to lift** and **which Bun APIs to mirror** per domain slice.
Grounded in `agent patterns` + lift map from cached research runs (excerpts below).

## Local Bun SSOT (this repo)

GitHub Kalshi bots are mostly Python/Node — **this research pipeline** is the Bun reference implementation:

- **Bun APIs in use:** Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep
- **Source files:** `src/agent/agent-report.ts`, `src/agent/architecture-blueprint.ts`, `src/agent/pattern-extract.ts`, `src/agent/report-term.ts`, `src/research/audit-adapter.ts`, `src/research/cache.ts`, `src/research/cli.ts`, `src/research/dimensions.ts`, `src/research/discover.ts`, `src/research/evidence-io.ts`, `src/research/export-audit.ts`, `src/research/gh.ts`, …

| Domain need | Lift auth/orders from | Implement with (local Bun) |
|-------------|---------------------|----------------------------|
| Price data | MM / price-data shortlist | `bun-websocket` + `bun-sqlite` |
| Wallet track | wallet-track shortlist | `bun-cron` + `bun-http` |
| Portfolio | tracking shortlist | `bun-file` + `bun-hash` |
| Execution / orders | market-making shortlist | `bun-http` + `bun-websocket` |
| Sports | sports-* dimensions (probe) | `bun-http` + `bun-cron` |

## Price / market data feeds (`price-data`)

**Recommended Bun stack:** Bun WebSocket + bun:sqlite
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun WebSocket | _not used locally yet_ |
| bun:sqlite | `src/research/cache.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep
- No shortlist — run research with --min-stars=1 if niche

## Wallet / balance tracking (`wallet-track`)

**Research run:** `2026-07-22T06-34-31-618Z` (2026-07-22T06:34:31.618Z)
**Recommended Bun stack:** Bun.cron + Bun.serve
**Reference repo:** bullmeme777/kalshi-portfolio-tracker (47.75) — scored
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `bullmeme777/kalshi-portfolio-tracker` (21.75/25) scored
  - KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS); official SDK markers
  - ↳ pattern: env secrets, key file
  - ↳ file: `README.md`
  - ↳ excerpt: `py | +-- requirements.txt +-- README.md ``` --- ## Requirements ``` python-dotenv, typer[all], httpx, kalshi-python, pandas ``` * Kalshi account with API read access * Telegram bot token (for alerts a…`
- **orderRealism** ← `bullmeme777/kalshi-portfolio-tracker` (17.5/25) scored
  - live order path markers; cent price bounds (1–99 / price_cents)
  - ↳ pattern: order fields (side/count/price)
  - ↳ file: `README.md`
  - ↳ excerpt: `py | +-- requirements.txt +-- README.md ``` --- ## Requirements ``` python-dotenv, typer[all], httpx, kalshi-python, pandas ``` * Kalshi account with API read access * Telegram bot token (for alerts a…`

### Shortlist

- `bullmeme777/kalshi-portfolio-tracker` — 47.75 — scored · UNLICENSED

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).
- License warning: bullmeme777/kalshi-portfolio-tracker lack usable OSS license.
**Lift map:** auth ← bullmeme777/kalshi-portfolio-tracker · orders ← bullmeme777/kalshi-portfolio-tracker

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.cron | `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |
| Bun.serve | `src/research/serve.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep

## Portfolio tracking / monitoring (`tracking`)

**Research run:** `2026-07-22T06-34-52-547Z` (2026-07-22T06:34:52.547Z)
**Recommended Bun stack:** Bun.file / Bun.write + Bun.CryptoHasher
**Reference repo:** bullmeme777/kalshi-portfolio-tracker (47.75) — scored
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `bullmeme777/kalshi-portfolio-tracker` (21.75/25) scored
  - KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS); official SDK markers
  - ↳ pattern: env secrets, key file
  - ↳ file: `README.md`
  - ↳ excerpt: `py | +-- requirements.txt +-- README.md ``` --- ## Requirements ``` python-dotenv, typer[all], httpx, kalshi-python, pandas ``` * Kalshi account with API read access * Telegram bot token (for alerts a…`
- **orderRealism** ← `bullmeme777/kalshi-portfolio-tracker` (17.5/25) scored
  - live order path markers; cent price bounds (1–99 / price_cents)
  - ↳ pattern: order fields (side/count/price)
  - ↳ file: `README.md`
  - ↳ excerpt: `py | +-- requirements.txt +-- README.md ``` --- ## Requirements ``` python-dotenv, typer[all], httpx, kalshi-python, pandas ``` * Kalshi account with API read access * Telegram bot token (for alerts a…`

### Shortlist

- `bullmeme777/kalshi-portfolio-tracker` — 47.75 — scored · UNLICENSED
- `kevinhjshim/kalshi-pnl` — 27.75 — scored · UNLICENSED
- `slee8495/kalshi-pnl-dashboard` — 29.25 — scored · UNLICENSED

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).
- License warning: bullmeme777/kalshi-portfolio-tracker, kevinhjshim/kalshi-pnl, slee8495/kalshi-pnl-dashboard lack usable OSS license.
- Composite bot: lift modules per component from different repos (see recommendations map).
**Lift map:** auth ← bullmeme777/kalshi-portfolio-tracker · orders ← bullmeme777/kalshi-portfolio-tracker

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.file / Bun.write | `src/agent/agent-report.ts`, `src/agent/architecture-blueprint.ts`, `src/agent/pattern-extract.ts`, `src/agent/report-term.ts` |
| Bun.CryptoHasher | `src/agent/pattern-extract.ts`, `src/research/audit-adapter.ts`, `src/research/evidence-io.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep

## Market making / liquidity (`market-making`)

**Research run:** `2026-07-22T06-13-45-870Z` (2026-07-22T06:13:45.870Z)
**Recommended Bun stack:** Bun.serve + Bun WebSocket
**Reference repo:** rodlaf/KalshiMarketMaker (67.75) — watchlist
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `rodlaf/KalshiMarketMaker` (21.25/25) watchlist
  - KALSHI access headers in code; trade-api/v2; official SDK markers
  - ↳ pattern: KALSHI-ACCESS-* headers, RSA-PSS, key file
  - ↳ file: `kalshi_market_maker/core/kalshi_api.py`
  - ↳ excerpt: `= self._create_signature(timestamp, method, path) return { "KALSHI-ACCESS-KEY": self.api_key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp, "Content-Type": "applicatio…`
- **orderRealism** ← `rodlaf/KalshiMarketMaker` (25/25) watchlist
  - live order path markers; dry-run / paper default
  - ↳ pattern: create-order API, order fields (side/count/price), portfolio/orders path
  - ↳ file: `kalshi_market_maker/core/kalshi_api.py`
  - ↳ excerpt: `= self._create_signature(timestamp, method, path) return { "KALSHI-ACCESS-KEY": self.api_key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp, "Content-Type": "applicatio…`

### Shortlist

- `rodlaf/KalshiMarketMaker` — 67.75 — watchlist

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).
- Watchlist tier (1): rodlaf/KalshiMarketMaker — auditable at ≥65/≥12, status open.
**Lift map:** auth ← rodlaf/KalshiMarketMaker · orders ← rodlaf/KalshiMarketMaker

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/research/serve.ts` |
| Bun WebSocket | _not used locally yet_ |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep

## Cross-venue arbitrage (`arbitrage`)

**Research run:** `2026-07-22T06-19-51-053Z` (2026-07-22T06:19:51.053Z)
**Recommended Bun stack:** Bun.cron + Bun.serve
**Reference repo:** RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot (69.5) — watchlist
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot` (15/25) watchlist
  - KALSHI access headers in code; trade-api/v2
  - ↳ pattern: KALSHI-ACCESS-* headers, RSA-PSS, key file, trade-api/v2
  - ↳ file: `app/clients/kalshi/base.py`
  - ↳ excerpt: `headers = { "Content-Type": "application/json", "KALSHI-ACCESS-KEY": self.key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp_str, } return headers def sign_pss_text(sel…`
- **orderRealism** ← `RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot` (25/25) watchlist
  - live order path markers; dry-run / paper default
  - ↳ pattern: create-order API, order fields (side/count/price), portfolio/orders path
  - ↳ file: `app/clients/kalshi/kalshi_http_client.py`
  - ↳ excerpt: `vironment) self.host = self.HTTP_BASE_URL self.exchange_url = "/trade-api/v2/exchange" self.markets_url = "/trade-api/v2/markets" self.portfolio_url = "/trade-api/v2/portfolio" self.events_url = "/tra…`

### Shortlist

- `RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot` — 69.5 — watchlist

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).
- Watchlist tier (1): RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot — auditable at ≥65/≥12, status open.
**Lift map:** auth ← RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot · orders ← RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.cron | `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |
| Bun.serve | `src/research/serve.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep

## NBA (`sports-nba`)

**Research run:** `2026-07-22T09-00-00-001Z` (2026-07-22T09:02:52.413Z)
**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `—` (0/25) —
  - No shortlist candidates
- **orderRealism** ← `—` (0/25) —
  - No shortlist candidates

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/research/serve.ts` |
| Bun.cron | `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep
- No gated candidates yet — probe with `--min-stars=2`

## NFL (`sports-nfl`)

**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/research/serve.ts` |
| Bun.cron | `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep
- No gated candidates yet — probe with `--min-stars=2`

## Soccer (`sports-soccer`)

**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/research/serve.ts` |
| Bun.cron | `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep
- No gated candidates yet — probe with `--min-stars=2`

## Other sports (MLB, NHL, tennis, …) (`sports-other`)

**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/research/serve.ts` |
| Bun.cron | `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep
- No gated candidates yet — probe with `--min-stars=2`

## Elections / politics (`sports-elections`)

**Research run:** `2026-07-22T06-19-15-682Z` (2026-07-22T06:19:15.682Z)
**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `—` (0/25) —
  - No shortlist candidates
- **orderRealism** ← `—` (0/25) —
  - No shortlist candidates

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/research/serve.ts` |
| Bun.cron | `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep
- No gated candidates yet — probe with `--min-stars=2`

## Macro / economic events (`sports-macro`)

**Research run:** `2026-07-22T06-19-21-281Z` (2026-07-22T06:19:21.281Z)
**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `—` (0/25) —
  - No shortlist candidates
- **orderRealism** ← `—` (0/25) —
  - No shortlist candidates

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/research/serve.ts` |
| Bun.cron | `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep
- No gated candidates yet — probe with `--min-stars=2`
