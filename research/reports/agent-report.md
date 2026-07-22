# Kalshi agent report — dimension architecture

Generated: 2026-07-22T06:32:33.402Z

Cross-dimension summary for bot architecture decisions. Pair with `agent suggest-lift` and `agent patterns` per dimension.

## Cross-venue arbitrage (`arbitrage`)

Run: `2026-07-22T06-19-51-053Z` · 2026-07-22T06:19:51.053Z
Discovered 14 → gated 1 → shortlist 1

- **RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot** — 69.5 — ⚠ watchlist
  - pattern: KALSHI-ACCESS-* headers, RSA-PSS, key file, trade-api/v2

## Market making / liquidity (`market-making`)

Run: `2026-07-22T06-13-45-870Z` · 2026-07-22T06:13:45.870Z
Discovered 27 → gated 1 → shortlist 1

- **rodlaf/KalshiMarketMaker** — 67.75 — ✗ unverified
  - pattern: KALSHI-ACCESS-* headers, RSA-PSS, key file, create-order API

## Elections / politics (`sports-elections`)

Run: `2026-07-22T06-19-15-682Z` · 2026-07-22T06:19:15.682Z
Discovered 10 → gated 0 → shortlist 0

_Discovered repos but none passed gate/shortlist — try --min-stars=2 or refine queries_

## Macro / economic events (`sports-macro`)

Run: `2026-07-22T06-19-21-281Z` · 2026-07-22T06:19:21.281Z
Discovered 5 → gated 0 → shortlist 0

_Discovered repos but none passed gate/shortlist — try --min-stars=2 or refine queries_

## NBA (`sports-nba`)

Run: `2026-07-22T06-18-19-984Z` · 2026-07-22T06:18:19.984Z
Discovered 8 → gated 0 → shortlist 0

_Discovered repos but none passed gate/shortlist — try --min-stars=2 or refine queries_

## Portfolio tracking / monitoring (`tracking`)

Run: `2026-07-22T06-19-27-172Z` · 2026-07-22T06:19:27.172Z
Discovered 0 → gated 0 → shortlist 0

_Zero discovery — broaden dimension queries_

## Architecture notes

- Cross-venue arbitrage: lift candidate RichardFeynmanEnthusiast/kalshi-polymarket-arbitrage-bot (69.5) — watchlist tier
- Market making / liquidity: lift candidate rodlaf/KalshiMarketMaker (67.75) — watchlist tier
- Composite bot: mix component lifts across dimensions (see suggest-lift per dimension).
