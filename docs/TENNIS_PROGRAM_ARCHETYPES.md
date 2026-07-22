# Tennis program archetypes

The Odds API boundary settles the architecture: **tour-level named events have a sharp reference; everything below is self-model territory.** That is two program archetypes, not one. Same institutions (`event-store`, fees, recorder, watcher). Different hypotheses, different graduation metrics, different matches the first tenants even watch.

## Split

| | **Tour sharp** (`tennis-tour-pinnacle-novig`) | **Self-model** (`tennis-game-model`) |
|--|--|--|
| **Watches** | ATP/WTA named events with Odds API keys (Aus Open, Masters, …) | Challenger + ITF (and any tour event without a sharp book on the feed) |
| **Edge** | Racing Pinnacle no-vig consensus vs Kalshi after fees | Being the only number in the room — model vs market mid |
| **Reference** | The Odds API → Pinnacle | None — self-calibration against resolved outcomes |
| **Hypothesis file** | [`alpha/tennis-tour-pinnacle-novig/hypothesis.md`](../alpha/tennis-tour-pinnacle-novig/hypothesis.md) | [`alpha/tennis-game-model/hypothesis.md`](../alpha/tennis-game-model/hypothesis.md) |
| **Graduation** | Realized edge after fees vs consensus lag (baseline-measurable) | Realized edge + mid-band calibration; no Odds API dependency |
| **First watch list** | Tour match + ladder when open | Calendar `tradable` sort: mid-price 30–70¢ and underdog legs — not 93/96¢ favorites |

Do not merge these into one tenant. A single `p_model` that sometimes subtracts Pinnacle and sometimes invents a number will launder unmeasured risk into the graduation proposal.

## Licensing — primary facts, not compilations

Match results are facts; facts are not copyrightable (*Feist*). What third-party CSV licenses (e.g. Sackmann CC BY-NC-SA) cover is the *compilation* — selection, formatting, assembly. The license-clean path is **our own collector against primary sources**:

- ITF site → futures / ITF results
- ATP / WTA official sites → Challenger and tour

Practical rules:

1. Scrape primary sources politely (cache aggressively, respect crawl cadence).
2. Store **provenance on every row**: `source`, `source_url`, `fetched_ts` (plus `ingested_at`). Provenance makes the license question auditable; theology does not.
3. If Sackmann (or any third-party compilation) is used at all, quarantine it to `corpus = 'research-only'`. That corpus **never** feeds `p_model` construction or trading graduation metrics.
4. Schema gets provenance columns **before** first primary ingest — retrofitting a million rows does not happen.

Event-store SSOT: [`src/institutions/event-store/schema.sql`](../src/institutions/event-store/schema.sql).

## Recorder — full ladder, not winners-only

Latency-decay matters most where the game-model will trade: set winners, set-1-game winners, game spreads, exact score. Those books reprice per point.

**Join key across series:** the matchup date-blob (e.g. `26JUL22BORBUR`), not `event_ticker` equality. Kalshi puts set/exact markets on sibling series:

| Family | Match winner | Ladder (examples) |
|--------|--------------|-------------------|
| ATP tour | `KXATPMATCH` | `KXATPSETWINNER`, `KXATPS1GWINNER`…`S5`, `KXATPGWINNER`, `KXATPGAMESPREAD`, `KXATPEXACTMATCH`, `KXATPGAMETOTAL` |
| WTA tour | `KXWTAMATCH` | `KXWTASETWINNER`, `KXWTAEXACTMATCH`, … |
| Challenger | `KXATPCHALLENGERMATCH` / `KXCHALLENGERMATCH` / `KXWTACHALLENGERMATCH` | thin / evolving |
| ITF | `KXITFMATCH` / `KXITFWMATCH` / doubles | **winners only today** — no set/game series listed |

Recorder contract: for each watched matchup blob, poll **every open market** under the family’s ladder series list. Coverage is reported per poll (`match_winner` / `set_winner` / `s1_game` / …). Empty ladder slots are logged, not silently ignored.

**WebSocket cue:** when open ladder includes per-point books (`s1_game`, `game_winner`) and REST interval ≥ typical point duration, REST is archaeology — escalate to a WebSocket writer. That is a hard cue, not a later refinement.

```bash
bun run tennis:record -- --event=KXATPMATCH-26JUL22BORBUR   # expands to full ladder
bun run tennis:record -- --watch                            # lead-aligned watch-set books
bun run tennis:record -- --top=10                           # volume sampling override
```

## Sequence

1. Provenance columns in event-store schema (done with this doc).
2. Results collector — ITF primary first, then Challenger from ATP/WTA sites — every row with provenance, `corpus=trading`.
3. Recorder loop with full ladder coverage report; WS when per-point books are live.
4. Fortnight of aging data → latency-gap distribution, not a vibe.

### ITF primary collector (live)

Feed: Stadion sports-data behind [WTT Live](https://www.itftennis.com/en/world-tennis-tour-live/) —
`https://api.itf-production.sports-data.stadion.io/custom/wttCompleteMatchList/YYYY-MM-DD`
(date **must** be dashed). Cache-first under `research/cache/itf-stadion/`; pause between days.

```bash
bun run tennis:collect -- --days=3          # last 3 UTC days, singles → corpus=trading
bun run tennis:collect -- --day=2026-07-21 --format=all
bun run tennis:collect -- --bridge-only     # re-link only (no collect)
bun run tennis:itf -- --sync                # Kalshi REST → events/markets, then bridge
bun run tennis:itf -- --sync --retain-days=3  # also closed/settled in lookback (default 3; 0=open-only)
bun run tennis:record -- --watch --sync     # books for watch-set (not vanity --top)
bun run tennis:record                       # bare = watch-set (not all open books)
bun run tennis:record -- --all-open         # opt-in bulk open ITF books
bun run tennis:record -- --loop             # defaults to watch-set
bun run tennis:record -- --loop --top=15    # volume sampling override
```

**Control plane (shared watch membership):**

```
sync (Kalshi REST) → events/markets
live poll → live_scores.is_live / score_snapshots (source_clock=recv)
watch set = start_ts ≤ now+lead OR is_live
record --watch → book_ticks (ts=recv_ts, source_clock=recv; per-ticker after fetchBook)
collect (Stadion) → events + resolutions
bridge (after sync or collect) → event_links + resolution on Kalshi event_id
```

**Book tick clocks:** REST `book_ticks` stamp `recv_ts` after each successful `fetchBook`, set `ts = recv_ts`, and label `source_clock='recv'` (same recv semantics as live scores — no exchange book timestamp on `BookSnapshot` today). Indexed queries keep using `ts`.

**WebSocket recorder:** `tennis:record -- --ws` opens an authenticated Kalshi WS (`wss://external-api-ws.kalshi.com/trade-api/ws/v2`), subscribes `orderbook_delta` for the watch-set tickers, reconstructs books from snapshot+delta. **`seq` is per subscription (sid), not per ticker** — stream-level gap detection in [`orderbook-stream.ts`](../src/institutions/event-store/orderbook-stream.ts); gap → `get_snapshot` + stream reset. Watch-set growth uses `update_subscription` `add_markets` (not full resubscribe). Writes `book_ticks` with `source='kalshi-ws'`. When delta `ts_ms` is present: `ts=ts_ms`, `source_clock='exchange'`; always store `recv_ts` at message receipt. Requires `KALSHI_API_KEY_ID` + `KALSHI_PRIVATE_KEY_PATH` (or `KALSHI_PRIVATE_KEY`). `--ws --dry-run` lists tickers only.

**WS visual ground (Bun.WebView + Bun.Image):** `tennis:ws-ground` renders a self-contained HTML dashboard from event-store (`book_ticks` + watch-set), navigates via `data:text/html` in headless `Bun.WebView`, captures `dashboard.png`, and writes a WebP thumb with `Bun.file(...).image().resize(...).webp()`. Artifacts under `research/cache/tennis-ws-ground/`; `agent tennis --webview` runs ground + capture. `@see` [WebView](https://bun.com/docs/runtime/webview) · [Image](https://bun.com/docs/runtime/image). Implementation: [`tennis-ws-dashboard.ts`](../src/institutions/event-store/tennis-ws-dashboard.ts) · [`tennis-ws-ground.ts`](../src/institutions/event-store/tennis-ws-ground.ts) · [`tennis-book-coverage.ts`](../src/institutions/event-store/tennis-book-coverage.ts) · [`tennis-ws-recorder-store.ts`](../src/institutions/event-store/tennis-ws-recorder-store.ts).

**File naming (event-store WS book lane):**

| Prefix | Role | Examples |
|--------|------|----------|
| `kalshi-*` | Kalshi wire integration | `kalshi-ws-recorder.ts`, `kalshi-itf-sync.ts`, `src/bot/kalshi-ws.ts` |
| `tennis-ws-*` | Tennis WS ground + artifacts | `tennis-ws-dashboard.ts`, `tennis-ws-ground.ts`, `tennis-ws-recorder-store.ts`, `tennis-ws-lane.ts` (barrel) |
| `tennis-book-*` | Tennis book analytics | `tennis-book-coverage.ts` |
| `orderbook-*` | Protocol-level book state (shared) | `orderbook-live.ts`, `orderbook-stream.ts` |
| `live-*` | Live scores canary lane | `live-scores.ts`, `live-canary-store.ts` |
| `tools/tennis/tennis-ws-*-cli.ts` | WS-specific CLIs | `tennis-ws-ground-cli.ts` |

Helper SSOT: [`src/institutions/event-store/watch-set.ts`](../src/institutions/event-store/watch-set.ts) (`listWatchEvents` / `listRecordTickers`). `--lead` default 5m on both `tennis:live` and `tennis:record --watch`.

**Retain sync:** Stadion collect is completed results; open-only Kalshi sync misses matchups that closed before bridge. `--sync` defaults to `--retain-days=3` (open + `status=closed` with `min_close_ts` + `status=settled` with `min_settled_ts`). `retainDays=0` restores open-only. Closed/settled markets with Kalshi `result` fill `winner`/`outcome` when not already bridged.

**Stadion ↔ Kalshi bridge:** namespaces stay separate (`itf|stadion|{matchId}` vs competitor-UUID Kalshi ids). `event_links` joins on UTC day + sorted last names + series lane (`KXITFMATCH` / `KXITFWMATCH` / doubles). Stadion probes day±1 for timezone pad, but when the same surnames+lane appear on multiple Stadion days, only the primary-day hit may link (blocks adjacent-day false uniques). Ambiguous keys hard-fail (`status=ambiguous`, no invented pair). On `linked`, Stadion resolution is upserted onto the Kalshi `event_id` (outcome bit remapped to Kalshi `player_a`/`player_b` order) so `book_ticks` can join outcomes. Bridge runs after Kalshi `--sync` on `tennis:itf` / `tennis:live` / `tennis:record` (skip with `--bridge=false`); collect already bridges.

**Kalshi live scores (early-start):** `GET /milestones?related_event_ticker=` → `GET /live_data/milestone/{id}`. Competitor UUIDs in live_data match `custom_strike.tennis_competitor`. Scoreboard matchup is **c1 vs c2** (UUID→`yes_side_label`), same axis as sets/games/pts — not localeCompare `player_a`/`player_b`. Watch set = `outcome=scheduled` and (`start_ts` in `[now−6h, now+lead]` **or** fresh `is_live`). `is_live` clears after 45m without refresh (stuck `in_progress`) or on terminal status. Timestamps are `source_clock=recv`. Stadion still owns final settlement. Bridge probes Stadion day ±1 vs Kalshi occurrence (multi-hit → ambiguous).

**Agent subagents:** `.cursor/skills/tennis-infra-orchestrate` launches review + integrate in parallel; specialists are `tennis-infra-review` and `tennis-infra-integrate`. Rule: `.cursor/rules/tennis-event-store.mdc`.

```bash
bun run agent tennis                          # event-store + canary artifact + cadence (no network)
bun run agent tennis --canary                 # live dry-run canary then ground
bun run agent tennis --webview                # ground + WebView/Image dashboard artifact
bun run tennis:ws-ground                      # visual ground only (no network)
bun run tennis:ws-ground -- --html-only       # HTML artifact; skip WebView when unavailable
bun run tennis:live -- --sync --loop          # promote: real writes + aging loop
bun run tennis:live -- --event=KXITFWMATCH-…  # one event (always prints score line)
bun run tennis:live -- --dry-run              # full read → write boundary; no DB writes
bun run tennis:live -- --canary               # dry-run + artifact + exit 2 on drift
bun run tennis:live -- --dry-run --verbose    # every watch-set score line
bun run tennis:live -- --event=… --json       # full payload: watchEvents + rows + liveIds
bun run tennis:live:cadence                   # REST vs WS from score_snapshots gaps
bun run tennis:record -- --watch --dry-run    # list watch-set tickers — no book writes
bun run tennis:record -- --watch --lead=10    # same lead window as live
bun run tennis:record -- --ws --dry-run       # list WS subscribe targets
bun run tennis:record -- --ws --ws-seconds=60 # live orderbook WS → book_ticks (needs API key)
```

Bun-native poll: `dns.prefetch` + `fetch.preconnect` on Kalshi origin, `mapPool` concurrency (`TENNIS_LIVE_CONCURRENCY`, default 4) for fetch, serial write-boundary apply, `Bun.nanoseconds` duration, `Bun.inspect.table` cadence tables, canary fingerprint via `Bun.hash` → `research/cache/tennis-canary/`.

### Live dry-run as canary

`--dry-run` is not a stub: it runs milestones + `live_data` fetch and the **same write-boundary plan** as the real upsert (`planLiveScoreWrite` — fingerprint change decides `would_snapshots`). Only the SQLite writes are skipped. That makes it the cheapest schema-drift detector: if Kalshi renames a field, classification output changes or throws while the writer stays untouched.

| Signal | Meaning |
|--------|---------|
| `would_upsert → 0` on a day with live matches | API/fetch path moved before the recorder |
| `errors` / all milestones missing | parse or milestone selection broke |
| dry-run vs real disagree on counts | canary is lying — unit test pins equivalence |

**Schedule (OS Bun.cron, every 15m local):**

```bash
bun run tennis:live:canary              # one-shot smoke
bun run tennis:live:canary:preview
bun run tennis:live:canary:register     # launchd / crontab
bun run tennis:live:canary:remove
```

Override: `TENNIS_LIVE_CANARY_CRON_SCHEDULE`, `TENNIS_LIVE_CANARY_CRON_TITLE`.

**Equivalence check (once, or in CI):** fixture test `dry-run would_* matches real writer against same DB state` in `tests/institutions/live-scores.test.ts`. Against a live event manually: dry-run then real, same tickers — `would_upsert`/`would_snapshots` must match actual writes.

### Snapshot cadence (REST vs WebSocket)

Default poll interval: `TENNIS_LIVE_INTERVAL_MS` (10s). `score_snapshots` only appends on fingerprint change. Each poll classifies the coarsest delta (`point` / `game` / `set` / `status` / `server`).

```bash
# live measure: would_snapshots + transition kinds (dry-run loop)
TENNIS_LIVE_INTERVAL_MS=5000 bun run tennis:live -- --dry-run --loop --event=KXITF…
# after aging data: gap analysis vs assumed interval
bun run tennis:live:cadence
bun run tennis:live -- --cadence --event=KXITF… --json
```

`analyzeScoreSnapshotCadence` → `restVerdict`:
| verdict | median gap vs interval |
|---------|------------------------|
| `ok` | ≤ 1.5× |
| `borderline` | ≤ 3× |
| `miss` | > 3× — REST undersamples; WS candidate for game books |

Canary also probes wire shape: required `live_data.details` keys (`LIVE_DATA_REQUIRED_DETAIL_KEYS`). Rename a field → `wire_shape_drift` fail while the writer stays untouched.

**Promote:** real writes on, loop running, latency-decay dataset ages with live scores attached:

```bash
bun run tennis:live -- --sync --loop
# optional: tighter poll while measuring
TENNIS_LIVE_INTERVAL_MS=5000 bun run tennis:live -- --loop
```

The calendar said where the markets are. The collector is what lets a self-model disagree with them.
