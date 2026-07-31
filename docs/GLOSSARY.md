# Glossary — canonical data dictionary

Mirror of `src/institutions/glossary.ts` + `ledger-types.ts` + `error-codes.ts`.
The modules are the source of truth; this doc is the human view.
Wire shapes verified against Kalshi API docs 2026-07-28.

## HQ UI (living glossary)

| Surface | How |
|---------|-----|
| **Panel** | Header **Glossary (?)** — slide-over, search, grouped by category |
| **Inline tips** | `tip("id")` → `?` with title + click opens panel at entry |
| **Deeplink** | `#glossary` or `#glossary:avgKalshiVolumeFp` |
| **API** | `GET /api/glossary` → `{ schemaVersion: 3, tooltips, entries, filterCatalog, categories, statuses, codes, units }` |
| **Related** | Entry `seeAlso[]` → panel “related” chips (click opens target) |
| **Status** | `active` (default) · `deprecated` (+ `deprecatedBy`) · `draft` |
| **Unit** | Entry `unit` ∈ `UNITS` — cents · usd · pp · pct · count · … (chart/export) |
| **Governance** | `bun run glossary:check` — tips + integrity (seeAlso/unit/status) + filter catalogs |

Categories: `market` · `model` · `tournament` · `warehouse` · `trading` · `ui` · `pipeline` · `other`.

Add new terms only in `GLOSSARY_ENTRIES` (ids are stable tip keys).

## Golden rules

1. **Wire at the boundary, normalized inside.** Parsers in `ledger-types.ts`
   are the only place snake_case wire fields are touched. HQ, agents, and
   strategies consume `Normalized*` types only.
2. **Money is integer cents** (`*Cents`). Fixed-point dollar strings
   (`"0.5600"`) exist only on the wire; convert with `dollarsToCents`.
3. **Time is epoch millis** (`*AtMs`). Wire `*_ts` is unix seconds — multiply
   at the boundary.
4. **Fractional contracts** (`*_fp`) are parsed, flagged `fractional: true`,
   displayed — but never orderable from HQ (order entry is integer-only).
5. **DEP/WDL are reconciliation-only.** Kalshi has no programmatic
   deposit/withdraw endpoints; those codes appear only in our own records
   after bank-rail transfers.

## Short codes (`glossary.ts` → `CODES`)

| Code | Meaning |
|---|---|
| `DEP` | deposit — funds in via Kalshi web/bank rails; reconciled, never API-initiated |
| `WDL` | withdrawal — funds out via Kalshi web/bank rails; reconciled, never API-initiated |
| `TRF` | internal transfer between subaccounts |
| `ORD` | order — status `resting` / `pending` / `executed` / `canceled` |
| `FILL` | fill — executed quantity; has `isTaker` + `feeCents` |
| `POS` | position — signed contracts (+YES / −NO) |
| `BAL` | balance — available-to-trade; `portfolioValueCents` is separate |
| `FEE` | fee — taker or maker, cents |
| `SETL` | settlement — market resolution payout |
| `BOOK` | orderbook snapshot, yes-cents integer levels |
| `TICK` | price tick from ingest |
| `EVT` | canonical event (`kalshi:EVENT-TICKER`) |
| `MILE` | Kalshi milestone — groups event tickers |
| `RUN` | research run (id = UTC timestamp) |
| `PROG` | alpha program (`alpha/*/program.json`) |
| `SHDW` | shadow signal — hash-chained in `shadow-log.jsonl` |
| `CAL` | calibration run (`calibration/artifacts/<ts>`) |

## Units (`UNITS`)

Attach as `unit` on glossary entries for chart/export consumers.

| Unit | Convention |
|---|---|
| `cents` | integer; prices 1–99; canonical money unit |
| `usd` | US dollars (display/export; prefer cents interior) |
| `dollarsFp` | fixed-point dollar string — wire only |
| `countFp` | fixed-point contract string — fractional flagged, not orderable |
| `count` | integer count (contracts, events, gaps) |
| `pp` | percentage points (edge / probability delta) |
| `pct` | percent 0–100 (thresholds, shares) |
| `probability` | 0–1 model outputs (Elo) |
| `atMs` | epoch millis — canonical absolute time |
| `ms` | duration milliseconds (staleness windows) |
| `unixSec` | wire only; ×1000 at boundary |

## Lifecycle (`status`)

| Status | Meaning |
|--------|---------|
| `active` | Default when omitted — safe for consumers |
| `deprecated` | Do not use for new work; set `deprecatedBy` to replacement id |
| `draft` | WIP entry; may be excluded from hard surfaces later |

## Player profiles (volume / recency)

Full contract: [`PLAYER_PROFILES_META.md`](PLAYER_PROFILES_META.md) · code SSOT [`src/research/player-profile-meta.ts`](../src/research/player-profile-meta.ts).

| Canonical | Avoid |
|-----------|--------|
| `avgKalshiVolumeFp` / `avg_kalshi_volume_fp` | `avgVolume`, `avgKalshiVolume`, profile-level `avgVolumeFp` |
| `lastSeenAtMs` / `last_seen_ts` (event-store **ms**) | `lastSeenMs`, dual ISO `lastSeenAt` on the API |
| `profilesSource`: `warehouse` \| `seed` | inventing other source labels |
| markets `volume_24h_fp` then `volume_fp` | `poly_volume`, separate `price_history.db` |

## Normalized entities (`ledger-types.ts`)

- `NormalizedBalance` — balanceCents, portfolioValueCents, updatedAtMs
- `NormalizedPosition` — ticker, **signed** position (+YES/−NO), exposure,
  realized P&L, fees, lastUpdatedAtMs
- `NormalizedFill` — fillId/tradeId/orderId, side, action, count, yesPriceCents,
  isTaker, feeCents, createdAtMs
- `NormalizedOrder` — orderId, status, yesPriceCents, initial/fill/remaining
  counts, maker/taker fees; `isWorkingOrder()` = resting|pending

## Error codes (`error-codes.ts`)

| Code | HTTP | Meaning |
|---|---|---|
| `E_TICKER_REQUIRED` | 400 | missing market ticker |
| `E_SIDE_INVALID` | 400 | side must be yes/no |
| `E_COUNT_RANGE` | 400 | count integer 1–10000 |
| `E_PRICE_RANGE` | 400 | price integer 1–99¢ |
| `E_ORDER_ID_REQUIRED` | 400 | cancel target missing |
| `E_BODY_INVALID` | 400 | unparseable JSON body |
| `E_UPSTREAM` | 502 | Kalshi API error/timeout (`upstream` carries its code) |
| `E_NO_CREDS` | 503 | credentials not configured |
| `E_RATE_LIMITED` | 429 | HQ rate limit (100 req/min) |
| `E_STATE_UNSUPPORTED` | 400 | state not in whitelist |
| `E_BET_BLOCKED` | 403 | compliance block (logged) |
| `E_NOT_FOUND` | 404 | resource missing |
| `E_STALE` | 409 | section data older than cadence |

Kalshi's own error envelope is `{ code, message, details, service }` — its
code is preserved in the `upstream` field of `CodedError`.

## Tooltips

`TOOLTIPS` in `glossary.ts` feeds HQ hover hints (the `?` chips) — add copy
there, never inline in views.
