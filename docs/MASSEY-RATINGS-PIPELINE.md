# Massey Ratings data pipeline (Bun 1.4)

**Status:** Phase 1 (fetch -> parse -> store) built; Bun-API + efficiency audit done 2026-08-22.
**Runtime:** Bun 1.4.x (Rust rewrite) - see BUN_UPGRADE_CANARY.md for the canary policy.
**Gate:** bun run check green on Bun 1.4.0 (guard + typecheck + full suite); the one
full-suite flake (POST /ops/kalshi-rotate-key) passes standalone and is unrelated.

## Verified Massey facts (2026-08-22 probe via Bun.WebView)

- Cloudflare: plain fetch to masseyratings.com -> 403 / Just a moment (verified with browser UA, 87ms).
- URL pattern: ratings tables at https://masseyratings.com/{sport}/{subdivision}/ratings
  (flat sports: /{sport}/ratings).
- Sport codes (verified): volleyball cvol (women D1/D2/D3), cmvol (men D1), dlv/dlvw (domestic),
  csand (sand); basketball cb/cbw/dlb; football cf/fbs, cf/fcs, nfl, cfl; soccer dls, csocw;
  tennis atp, wta; baseball mlb, cbase.
- Table shape (cvol/ncaa-d1): headers Team, Rec, Delta, Rat, Pwr, HFA, SoS, SSF, EW, EL;
  350 team rows; team cells concatenate the conference (NebraskaBig 10); a Correlation meta
  row is skipped. Domestic volleyball: dlv (men, 895 rows), dlvw (women, 801 rows) - club
  teams (Perugia, Vakifbank, ...) with country suffix in the team cell.
- CSV export is client-side only: the page More -> Export CSV action (exportCSV) builds the
  CSV in the browser from the rendered table - there is no server-side CSV endpoint, so DOM
  extraction is the canonical fetch path.

## Bun-native API usage + efficiency audit (2026-08-22)

| Concern | Finding | Fix shipped |
| --- | --- | --- |
| Native fetch | Bun native fetch is used first; Massey 403s it here (Cloudflare) | hybrid fast path: fetch + HTMLRewriter, WebView fallback |
| Browser spin-up cost | WebView ~4.2s per page (webkit) vs fetch ~87ms | native fast path avoids WebView whenever Cloudflare allows |
| Repeated futile fetches | Every request would retry the 403 | circuit breaker: after 2 consecutive native failures, skip the fast path for the process |
| HTML parsing | No DOM/third-party parser | Bun HTMLRewriter streaming extractor (html.ts) - verified byte-identical to the DOM path (350 rows, 0 mismatches) |
| Sequential multi-sport | CLI fetched targets one at a time | --concurrency pool (Promise.all batches) |
| Webkit serialization | Parallel webkit fetches measured SLOWER than sequential (6.06s vs 5.89s) - one shared host process | auto-cap concurrency to 1 on webkit; parallel only helps chrome/native paths |
| Refetch churn | Ratings update ~weekly, but every run refetched | --max-age-hours freshness skip (verified: 1ms skip on fresh snapshot) |
| Poll latency | Fixed 1s CF-wait poll | 500ms poll with deadline guard |
| Storage | bun:sqlite WAL + prepared statements + transactions, zero deps | already native (store.ts) |
| I/O | Bun.sleep, Response.text(), AbortSignal.timeout - all native | already native |

## Architecture

  fetch path:  Bun native fetch (fast) -> Cloudflare 403? -> circuit breaker -> Bun.WebView
              native fetch OK? -> HTMLRewriter table extract (html.ts) -> identical rows
  storage:    bun:sqlite research/cache/massey.db
              massey_snapshots (run metadata), massey_ratings (per-row, PK snapshot_id+rank)
  parse:      pure parse.ts (header map, Correlation skip, team/conference split, coercion)

### Modules

- src/institutions/massey/paths.ts - DEFAULT_MASSEY_DB, site origin.
- src/institutions/massey/sports.ts - MASSEY_SPORT_TARGETS registry, resolveMasseyTarget.
- src/institutions/massey/html.ts - HTMLRewriter ratings-table extractor (native fetch path).
- src/institutions/massey/fetch.ts - hybrid fetch: native fast path + WebView fallback + breaker.
- src/institutions/massey/parse.ts - pure parseMasseyRatingRows / splitMasseyTeamConference / ...
- src/institutions/massey/store.ts - openMasseyDb, upsertMasseyRatings, latest* helpers.
- tools/massey-sync-cli.ts - CLI (--sport, --sub, --write, --json, --concurrency, --max-age-hours,
  --no-native-fetch, --rows, --db).

## Usage

  bun run massey:sync -- --sport=cvol --sub=ncaa-d1 --write --rows=5   # fetch + persist + preview
  bun run massey:sync -- --sport=volleyball --dry-run                   # default: print only
  bun run massey:sync -- --sport=volleyball,basketball --write --max-age-hours=24
  bun run massey:sync -- --sport=cvol/ncaa-d1 --json                    # machine-readable

## Next phases

1. Crossref - join latest Massey ratings vs plive/ezlive skin_events lines (event-store.db):
   map Massey team/competition to competition_id, derive Massey-implied probability from
   EW/EL or winPct, compare with moneyline/spread/total, flag outliers.
2. Cron - register massey:sync jobs in scripts/cron-main.ts (env-gated, per-sport cadence).
3. Config + report - JSON5 sport config; markdown/HTML outlier report served like research/serve.ts.
4. Verify bun run check on Bun 1.4.0 (now the pinned baseline).
