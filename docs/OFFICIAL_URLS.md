# Official URLs

Canonical external links for this repo. **Code SSOT:** [`src/institutions/official-urls.ts`](../src/institutions/official-urls.ts).

Last verified: **2026-07-31**

**Liveness:**

| Command / route | Role |
|-----------------|------|
| `bun run glossary:urls` | Hard catalog check (CLI) |
| `bun run glossary:urls:json` / `health:urls` | Machine `UrlHealthReport` |
| `bun run glossary:urls:og` | Soft + Open Graph sample |
| `GET /api/health/urls` | Same probe via research server (`?glossary=1` optional) |
| `GET /api/health/kalshi?env=prod` | Kalshi `/exchange/status` only |
| `GET /regulatory/health` | Compliance + live Kalshi exchange |

Probes: [`OFFICIAL_URL_PROBES`](../src/institutions/official-urls.ts) · engine: [`url-health.ts`](../src/institutions/url-health.ts).

## Kalshi

| Resource | URL | Notes |
|----------|-----|--------|
| Fee schedule (live) | [kalshi.com/fee-schedule](https://kalshi.com/fee-schedule) | **Use this** — `kalshi.com/docs/trading/fees` is **404** |
| Fee schedule PDF | [kalshi-fee-schedule.pdf](https://kalshi.com/docs/kalshi-fee-schedule.pdf) | General taker: `round_up(0.07 × C × P × (1−P))` |
| Fee rounding | [docs.kalshi.com/.../fee_rounding](https://docs.kalshi.com/getting_started/fee_rounding) | Centicent trade fee + rebate accumulator |
| Event fee overrides | [get-event-fee-changes](https://docs.kalshi.com/api-reference/events/get-event-fee-changes) | Series/event multipliers |
| Trade API | [docs.kalshi.com](https://docs.kalshi.com/) | v2 REST + auth headers |
| Series list | [market/get-series-list](https://docs.kalshi.com/api-reference/market/get-series-list) | not under `/series/` |
| Portfolio: balance | [get-balance](https://docs.kalshi.com/api-reference/portfolio/get-balance) | cents ints + `*_dollars` fp strings |
| Portfolio: positions | [get-positions](https://docs.kalshi.com/api-reference/portfolio/get-positions) | `market_positions` + `event_positions`; signed `position`/`position_fp` |
| Portfolio: fills | [get-fills](https://docs.kalshi.com/api-reference/portfolio/get-fills) | `count_fp`, `fee_cost` dollars, `is_taker` |
| Orders | [orders/get-orders](https://docs.kalshi.com/api-reference/orders/get-orders) | (docs moved off `/portfolio/orders`) |
| API base (prod) | `…/trade-api/v2` | probe: `/exchange/status` |
| API base (demo) | demo host | probe: `/exchange/status` |

**Fixed-point migration (verified 2026-07-28):** portfolio endpoints ship BOTH
legacy integer cents (`balance`, `yes_price`) and fixed-point strings
(`balance_dollars`, `yes_price_dollars`, `position_fp`, `count_fp`). Parse at
the boundary only — `src/institutions/ledger-types.ts` (normalized types) and
`docs/GLOSSARY.md` (field conventions). Fractional contracts are display-only;
order entry stays integer.

**Error envelope:** all 4xx/5xx return `{ code, message, details, service }` —
mapped in `src/institutions/error-codes.ts` (`upstream` field).

**Deposits/withdrawals:** NO programmatic endpoints — bank rails via web UI.
Ledger codes `DEP`/`WDL` are reconciliation-only (see GLOSSARY.md).

**Fee math in code** (`src/institutions/kalshi-fees.ts`):

```text
feeCents = ceil(rate × contracts × P × (1 − P) × 100)
```

`ceil` is regressive at small size (1 contract @ 50¢ → 2¢). Default `MIN_CONTRACTS = 5`. Index series may use **0.035**, not 0.07.

## The Odds API (sharp consensus baseline)

| Resource | URL | Notes |
|----------|-----|--------|
| v4 guide | [liveapi/guides/v4](https://the-odds-api.com/liveapi/guides/v4/) | Sports odds endpoints |
| API base | `https://api.the-odds-api.com/v4` | Used in `src/alpha/odds-feed.ts` |
| Bookmakers | [bookmaker-apis](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html) | Pinnacle key `pinnacle` — not Circa |

Set `ODDS_API_KEY` in env for live fetches.

**Tennis coverage:** named ATP/WTA tournaments only — no Challenger/ITF sport keys. That boundary defines the two tennis program archetypes — see [`TENNIS_PROGRAM_ARCHETYPES.md`](TENNIS_PROGRAM_ARCHETYPES.md).

## Bun (runtime)

| Resource | URL |
|----------|-----|
| `bun create` templates | [templating/create](https://bun.com/docs/runtime/templating/create) |
| `bun:test` | [test](https://bun.com/docs/test/index#run-tests) |
| `bun:sqlite` | [sqlite](https://bun.com/docs/runtime/sqlite) |
| `Bun.fetch` | [fetch](https://bun.com/docs/runtime/networking/fetch#sending-an-http-request) |
| `Bun.CryptoHasher` (sha3) | [hashing](https://bun.com/docs/runtime/hashing#bun-cryptohasher) |
| `Bun.color` | [runtime/color](https://bun.com/docs/runtime/color) |
| `HTMLRewriter` | [html-rewriter](https://bun.com/docs/runtime/html-rewriter) |
| Environment variables | [environment-variables](https://bun.com/docs/runtime/environment-variables) |
| `URLPattern` | [blog v1.3.4](https://bun.com/blog/bun-v1.3.4#urlpattern-api) |
| `bun update` | [pm/cli/update](https://bun.com/docs/pm/cli/update) |

Full Bun map: [`docs/BUN_NATIVE.md`](BUN_NATIVE.md).

## GitHub (research harness)

| Resource | URL |
|----------|-----|
| Rate limits | [rate-limit](https://docs.github.com/en/rest/rate-limit/rate-limit) |
| Code search | [search-code](https://docs.github.com/en/rest/search/search#search-code) |

## Alpha programs

Scaffold from repo root (always `--no-git`):

```bash
bun create alpha-program alpha/<name> --no-git
```

See [`.bun-create/alpha-program/README.md`](../.bun-create/alpha-program/README.md).
