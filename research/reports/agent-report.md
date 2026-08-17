# Kalshi agent report — dimension architecture

Generated: 2026-08-15T22:00:08.332Z

Cross-dimension summary for bot architecture decisions. Pair with `agent patterns` and `agent blueprint` per dimension.

## Cross-venue arbitrage (`arbitrage`)

Run: `2026-07-22T09-33-07-231Z` · 2026-07-22T09:33:07.231Z
Discovered 1 → gated 1 → shortlist 0

_Discovered repos but none passed gate/shortlist — try --min-stars=2 or refine queries_

## Market making / liquidity (`market-making`)

Run: `2026-07-22T06-13-45-870Z` · 2026-07-22T06:13:45.870Z
Discovered 27 → gated 1 → shortlist 1

- **rodlaf/KalshiMarketMaker** — 67.75 — watchlist 🕒 35506m ago
  - pattern: KALSHI-ACCESS-* headers, RSA-PSS, key file, create-order API

## Price / market data feeds (`price-data`)

_No cached run — run: bun run research -- --dimension=price-data_

## Elections / politics (`sports-elections`)

Run: `2026-07-22T06-19-15-682Z` · 2026-07-22T06:19:15.682Z
Discovered 10 → gated 0 → shortlist 0

_Discovered repos but none passed gate/shortlist — try --min-stars=2 or refine queries_

## Macro / economic events (`sports-macro`)

Run: `2026-07-22T06-19-21-281Z` · 2026-07-22T06:19:21.281Z
Discovered 5 → gated 0 → shortlist 0

_Discovered repos but none passed gate/shortlist — try --min-stars=2 or refine queries_

## NBA (`sports-nba`)

Run: `2026-07-22T09-00-00-001Z` · 2026-07-22T09:35:01.630Z
Discovered 1 → gated 1 → shortlist 1

_Discovered repos but none passed gate/shortlist — try --min-stars=2 or refine queries_

## Portfolio tracking / monitoring (`tracking`)

Run: `2026-07-22T06-34-52-547Z` · 2026-07-22T06:34:52.547Z
Discovered 3 → gated 3 → shortlist 3

- **bullmeme777/kalshi-portfolio-tracker** — 47.75 — scored 🕒 35485m ago
  - pattern: env secrets, key file, order fields (side/count/price)
- **kevinhjshim/kalshi-pnl** — 27.75 — scored 🕒 35485m ago
- **slee8495/kalshi-pnl-dashboard** — 29.25 — scored 🕒 35485m ago

## Wallet / balance tracking (`wallet-track`)

Run: `2026-07-22T06-34-31-618Z` · 2026-07-22T06:34:31.618Z
Discovered 1 → gated 1 → shortlist 1

- **bullmeme777/kalshi-portfolio-tracker** — 47.75 — scored 🕒 35486m ago
  - pattern: env secrets, key file, order fields (side/count/price)

## Architecture notes

- Market making / liquidity: lift candidate rodlaf/KalshiMarketMaker (67.75) — watchlist tier
- Composite bot: mix component lifts across dimensions (see agent blueprint / patterns per dimension).
