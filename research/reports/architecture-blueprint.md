# Kalshi bot architecture blueprint

Generated: 2026-08-15T21:59:58.294Z

Single reference for **what to lift** and **which Bun APIs to mirror** per domain slice.
Grounded in `agent patterns` + lift map from cached research runs (excerpts below).

## Local Bun SSOT (this repo)

GitHub Kalshi bots are mostly Python/Node — **this research pipeline** is the Bun reference implementation:

- **Bun APIs in use:** Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
- **Source files:** `src/agent/agent-report.ts`, `src/agent/architecture-blueprint.ts`, `src/agent/pattern-extract.ts`, `src/agent/report-term.ts`, `src/agent/tennis-ground.ts`, `src/alpha/odds-feed.ts`, `src/alpha/run-shadow-once.ts`, `src/alpha/ticker-mapper.ts`, `src/bot/kalshi-rotate.ts`, `src/bot/kalshi-ws.ts`, `src/calibration/init-program.ts`, `src/calibration/shadow-maintenance.ts`, …

| Domain need | Lift auth/orders from | Implement with (local Bun) |
|-------------|---------------------|----------------------------|
| Price data | MM / price-data shortlist | `bun-websocket` + `bun-sqlite` |
| Wallet track | wallet-track shortlist | `bun-cron` + `bun-http` |
| Portfolio | tracking shortlist | `bun-file` + `bun-hash` |
| Execution / orders | market-making shortlist | `bun-http` + `bun-websocket` |
| Sports | sports-* dimensions (probe) | `bun-http` + `bun-cron` |
| Alpha (odds) | `odds-feed` dimension (lift only) | `src/alpha/odds-feed.ts` + `bun-http` + `bun-sqlite` |

## Alpha pipeline (`src/alpha/`)

Product code — build by hand in parallel with harness runs. Only **`odds-feed`** is a research dimension (vig strip, Odds API clients). Ticker mapping, shadow logging, and calibration are **not** GitHub-discovery targets.

| Component | Source | Module |
|-----------|--------|--------|
| Odds feed + vig strip | `odds-feed` dimension (when quota allows) + hand-built | `src/alpha/odds-feed.ts`, `vig-strip.ts` |
| Ticker mapping | Hand-built (Kalshi-specific glue) | `src/alpha/ticker-mapper.ts` + `research/ticker-overrides.json` |
| Fee-aware edge | `feeAware` detector + locked `/plan` math | `src/alpha/edge.ts` |
| Shadow + calibration | Standalone tools (not research dimensions) | `research/cache/shadow-log.jsonl`; Brier tool TBD |

```bash
# Harness — offline understanding first (zero live GitHub)
bun run research:dry -- --dimension=odds-feed
# Live dry-run (search + rate_limit only) when warming cache:
# bun run research -- --dry-run --dimension=odds-feed
bun run agent patterns --dimension=odds-feed

# Product (now — not blocked on research)
bun test tests/vig-strip.test.ts tests/odds-feed.test.ts tests/ticker-mapper.test.ts
```

## Price / market data feeds (`price-data`)

**Recommended Bun stack:** Bun WebSocket + bun:sqlite
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun WebSocket | `src/partner/fantasy-ultra/widget-config.ts` |
| bun:sqlite | `src/agent/tennis-ground.ts`, `src/alpha/odds-feed.ts`, `src/alpha/ticker-mapper.ts`, `src/institutions/event-store/cross-market.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
- No shortlist — run research with --min-stars=1 if niche

## Wallet / balance tracking (`wallet-track`)

**Research run:** `2026-07-22T06-34-31-618Z` (2026-07-22T06:34:31.618Z)
**Recommended Bun stack:** Bun.cron + Bun.serve
**Reference repo:** bullmeme777/kalshi-portfolio-tracker (47.75) — scored 🕒 35485m ago
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `bullmeme777/kalshi-portfolio-tracker` (21.75/25) scored 🕒 35485m ago
  - KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS); official SDK markers
  - ↳ pattern: env secrets, key file
  - ↳ file: `README.md`
  - ↳ excerpt: `py | +-- requirements.txt +-- README.md ``` --- ## Requirements ``` python-dotenv, typer[all], httpx, kalshi-python, pandas ``` * Kalshi account with API read access * Telegram bot token (for alerts a…`
- **orderRealism** ← `bullmeme777/kalshi-portfolio-tracker` (17.5/25) scored 🕒 35485m ago
  - live order path markers; cent price bounds (1–99 / price_cents)
  - ↳ pattern: order fields (side/count/price)
  - ↳ file: `README.md`
  - ↳ excerpt: `py | +-- requirements.txt +-- README.md ``` --- ## Requirements ``` python-dotenv, typer[all], httpx, kalshi-python, pandas ``` * Kalshi account with API read access * Telegram bot token (for alerts a…`

### Shortlist

- `bullmeme777/kalshi-portfolio-tracker` — 47.75 — scored 🕒 35485m ago · UNLICENSED

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).
- License warning: bullmeme777/kalshi-portfolio-tracker lack usable OSS license.
**Lift map:** auth ← bullmeme777/kalshi-portfolio-tracker · orders ← bullmeme777/kalshi-portfolio-tracker

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket

## Portfolio tracking / monitoring (`tracking`)

**Research run:** `2026-07-22T06-34-52-547Z` (2026-07-22T06:34:52.547Z)
**Recommended Bun stack:** Bun.file / Bun.write + Bun.CryptoHasher
**Reference repo:** bullmeme777/kalshi-portfolio-tracker (47.75) — scored 🕒 35485m ago
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `bullmeme777/kalshi-portfolio-tracker` (21.75/25) scored 🕒 35485m ago
  - KALSHI access headers in code; trade-api/v2; auth freshness (recent commit + v2/PSS); official SDK markers
  - ↳ pattern: env secrets, key file
  - ↳ file: `README.md`
  - ↳ excerpt: `py | +-- requirements.txt +-- README.md ``` --- ## Requirements ``` python-dotenv, typer[all], httpx, kalshi-python, pandas ``` * Kalshi account with API read access * Telegram bot token (for alerts a…`
- **orderRealism** ← `bullmeme777/kalshi-portfolio-tracker` (17.5/25) scored 🕒 35485m ago
  - live order path markers; cent price bounds (1–99 / price_cents)
  - ↳ pattern: order fields (side/count/price)
  - ↳ file: `README.md`
  - ↳ excerpt: `py | +-- requirements.txt +-- README.md ``` --- ## Requirements ``` python-dotenv, typer[all], httpx, kalshi-python, pandas ``` * Kalshi account with API read access * Telegram bot token (for alerts a…`

### Shortlist

- `bullmeme777/kalshi-portfolio-tracker` — 47.75 — scored 🕒 35485m ago · UNLICENSED
- `kevinhjshim/kalshi-pnl` — 27.75 — scored 🕒 35485m ago · UNLICENSED
- `slee8495/kalshi-pnl-dashboard` — 29.25 — scored 🕒 35485m ago · UNLICENSED

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).
- License warning: bullmeme777/kalshi-portfolio-tracker, kevinhjshim/kalshi-pnl, slee8495/kalshi-pnl-dashboard lack usable OSS license.
- Composite bot: lift modules per component from different repos (see recommendations map).
**Lift map:** auth ← bullmeme777/kalshi-portfolio-tracker · orders ← bullmeme777/kalshi-portfolio-tracker

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.file / Bun.write | `src/agent/agent-report.ts`, `src/agent/architecture-blueprint.ts`, `src/agent/pattern-extract.ts`, `src/agent/report-term.ts` |
| Bun.CryptoHasher | `src/agent/pattern-extract.ts`, `src/institutions/event-store/visual-snapshot-meta.ts`, `src/partner/authorization/hash.ts`, `src/partner/execution/kalshi-live.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket

## Market making / liquidity (`market-making`)

**Research run:** `2026-07-22T06-13-45-870Z` (2026-07-22T06:13:45.870Z)
**Recommended Bun stack:** Bun.serve + Bun WebSocket
**Reference repo:** rodlaf/KalshiMarketMaker (67.75) — watchlist 🕒 35506m ago
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `rodlaf/KalshiMarketMaker` (21.25/25) watchlist 🕒 35506m ago
  - KALSHI access headers in code; trade-api/v2; official SDK markers
  - ↳ pattern: KALSHI-ACCESS-* headers, RSA-PSS, key file
  - ↳ file: `kalshi_market_maker/core/kalshi_api.py`
  - ↳ excerpt: `= self._create_signature(timestamp, method, path) return { "KALSHI-ACCESS-KEY": self.api_key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp, "Content-Type": "applicatio…`
- **orderRealism** ← `rodlaf/KalshiMarketMaker` (25/25) watchlist 🕒 35506m ago
  - live order path markers; dry-run / paper default
  - ↳ pattern: create-order API, order fields (side/count/price), portfolio/orders path
  - ↳ file: `kalshi_market_maker/core/kalshi_api.py`
  - ↳ excerpt: `= self._create_signature(timestamp, method, path) return { "KALSHI-ACCESS-KEY": self.api_key_id, "KALSHI-ACCESS-SIGNATURE": signature, "KALSHI-ACCESS-TIMESTAMP": timestamp, "Content-Type": "applicatio…`

### Shortlist

- `rodlaf/KalshiMarketMaker` — 67.75 — watchlist 🕒 35506m ago

### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).
- Watchlist tier (1): rodlaf/KalshiMarketMaker — auditable at ≥65/≥12, status open.
**Lift map:** auth ← rodlaf/KalshiMarketMaker · orders ← rodlaf/KalshiMarketMaker

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |
| Bun WebSocket | `src/partner/fantasy-ultra/widget-config.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket

## Cross-venue arbitrage (`arbitrage`)

**Research run:** `2026-07-22T09-33-07-231Z` (2026-07-22T09:33:07.231Z)
**Recommended Bun stack:** Bun.cron + Bun.serve
**Reference repo:** RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot (69.5)
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
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
- No shortlist — run research with --min-stars=1 if niche

## NBA (`sports-nba`)

**Research run:** `2026-07-22T09-00-00-001Z` (2026-07-22T09:35:01.630Z)
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
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
- No gated candidates yet — probe with `--min-stars=2`

## NFL (`sports-nfl`)

**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
- No gated candidates yet — probe with `--min-stars=2`

## Soccer (`sports-soccer`)

**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
- No gated candidates yet — probe with `--min-stars=2`

## Other sports (MLB, NHL, …) (`sports-other`)

**Recommended Bun stack:** Bun.serve + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
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
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
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
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
- No gated candidates yet — probe with `--min-stars=2`

## Odds API integration (`odds-feed`)

**Research run:** `2026-07-22T10-05-56-356Z` (2026-07-22T10:05:56.356Z)
**Recommended Bun stack:** Bun.serve + bun:sqlite + Bun.cron
**Reference repo:** _none yet — run dimension research_
**Bun features observed:** _none in evidence paths (likely Python stack — see Bun native implementation)_

### Lift recommendations (auth + orders)

- **authApi** ← `—` (0/25) —
  - No shortlist candidates
- **orderRealism** ← `—` (0/25) —
  - No shortlist candidates
## Gate miss

Discovered **46** repo(s); **0** passed gate (min-stars=500, min-forks=500, max-age-months=18).

### Near misses

1. **sportsdataverse/oddsapiR** — 9 stars, 5 forks, pushed 2026-06 — needs 500 stars or 500 forks
2. **aqsmith02/paper-betting-tracker** — 6 stars, 1 forks, pushed 2026-07 — needs 500 stars or 500 forks
3. **iliyasone/ps3838api** — 6 stars, 1 forks, pushed 2026-03 — needs 500 stars or 500 forks

### Suggested probe

```bash
bun run research -- --dimension=odds-feed --min-stars=9
```


### Lift notes

- No shortlist repo meets high-value audit export threshold (≥70 total, auth+order ≥15 each).

### Bun native implementation

| Bun API | Local reference |
|---------|-----------------|
| Bun.serve | `src/regulatory/examples/regulatory-server.ts`, `src/research/serve.ts` |
| bun:sqlite | `src/agent/tennis-ground.ts`, `src/alpha/odds-feed.ts`, `src/alpha/ticker-mapper.ts`, `src/institutions/event-store/cross-market.ts` |
| Bun.cron | `src/calibration/toxicity-schedule-cli.ts`, `src/institutions/event-store/match-liquidity-pipeline.ts`, `src/research/schedule-cli.ts`, `src/research/scheduled.ts` |

Notes:
- GitHub shortlist is non-Bun — mirror APIs from local stack: Bun.cron, Bun.file / Bun.write, Bun.CryptoHasher, Bun.serve, bun:sqlite, Bun.sleep, Bun WebSocket
