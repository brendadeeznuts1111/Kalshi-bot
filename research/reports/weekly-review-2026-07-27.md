# Weekly Strategy Review — 2026-07-27

**Project:** Kalshi Tennis Bot  
**Reviewer:** kimi (weekly strategy run)  
**Period:** 2026-07-23 → 2026-07-27  
**Base docs:** `docs/ROADMAP.md`, `docs/TENNIS_PROGRAM_ARCHETYPES.md`, `docs/PLAN.md`  

---

## 1. Data-plane Health (G3 keeper)

### Row-count snapshot

| Table | 2026-07-23 | 2026-07-27 | Δ |
|-------|-----------|-----------|---|
| `events` | 2,001 | 2,595 | **+594** |
| `markets` | 2,552 | 3,456 | **+904** |
| `resolutions` | 1,291 | 1,497 | **+206** |
| `book_ticks` | 1,875 | 1,875 | **0** |
| `event_links` | 724 | 865 | **+141** |
| `live_scores` | 10 | 10 | 0 |
| `score_snapshots` | 10 | 10 | 0 |
| `player_profiles` | — | **2,137** | new |

### Assessment

- **Events/markets growing:** ITF sync + collect pipeline is healthy. `tennis:itf -- --sync` and `tennis:collect -- --days=1` both exit 0 and produce real row growth.
- **book_ticks frozen:** Stuck at 1,875 since 2026-07-23. Breakdown: `kalshi-rest=1,696`, `kalshi-ws=179`. The WS recorder cron job was registered (`tennis:record:ws:register`) but **never executed successfully** because `KALSHI_API_KEY_ID` / `KALSHI_PRIVATE_KEY_PATH` are not set in the environment. This is the single largest data-plane gap.
- **Coverage gap:** `tennis-book-coverage.ts` reports `watchWithWs=0/78` (watch-set tickers have zero WS book_ticks). The 179 existing WS ticks are stale — from an earlier manual run, not the cron.
- **Canary:** 270 lines in `research/cache/tennis-canary/history.jsonl`. `tennis:live -- --canary` exits 0, `wire_ok=true`, but live window is often empty at off-peak CDT times (expected).
- **No canary drift** detected (schema/field shapes stable).
- **player_profiles:** New table, 2,137 profiles upserted by `tools/tennis/build-player-profiles.ts`. Appearances, wins, losses, win_rate, surfaces, avg_kalshi_volume_fp all populated.

### Data-plane verdict

| Lane | Status |
|------|--------|
| Event ingestion (ITF + collect) | ✅ Green |
| Bridge / resolution linking | ✅ Green |
| Live scores canary | ✅ Green |
| REST book_ticks | 🟡 Stale (1,696 rest ticks aging) |
| WS book_ticks | 🔴 Blocked (credentials) |
| Player profiles | ✅ Green |

---

## 2. Goal-by-Goal Status

Since `docs/KIMI_DISCOVERY_MAP.md` does not exist in this workspace, goals are mapped from the data-plane log conventions (G0 = GitHub rate-limit/code_search; G3 = data-plane keeper) plus the observable project blockers.

### G0 — `code_search` recovered / `rate-limit:status` readable

- **Status:** 🔴 **STALLED**
- `bun run rate-limit:status` exits 1: `GH_TOKEN / gh auth not set`
- The `gh` CLI token for account `brendadeeznuts1111` is invalid per 2026-07-23 and 2026-07-26 keeper entries.
- **Impact:** The GitHub research pipeline (`bun run research`) cannot verify its rate-limit budget before live runs. This blocks the "V5 — Live MM happy path" phase in `docs/ROADMAP.md`.
- **Unblock:** `gh auth login -h github.com` or export `GH_TOKEN`.

### G1 — Ticker-format modules (ITF + Tour + Challenger)

- **Status:** ✅ **DONE**
- `src/alpha/ticker-formats/itf.ts` — ITF match winner parsing.
- `src/alpha/ticker-formats/tour.ts` — ATP/WTA/Challenger series (`KXATPMATCH`, `KXWTAMATCH`, `KXATPCHALLENGERMATCH`, `KXWTACHALLENGERMATCH`).
- `src/alpha/ticker-formats/series-parse.ts` — shared parsing primitives.
- `tourFromSeries()` and `tourIsChallengerSeries()` correctly map fee structure (Challenger = maker-free quadratic).

### G2 — `placeOrder` wired for live execution

- **Status:** 🔴 **STUB — STALLED**
- `src/bot/kalshi-client.ts` lines 27–36: `placeOrder()` returns a dry-run fake ID only. Live path throws:
  ```
  Live Kalshi client not wired — lift from market-making shortlist before --live
  ```
- **Impact:** No alpha tenant can graduate to pilot or live. The shadow loop can simulate fills (`simulateFillVwap`) but cannot place real orders.
- **Note:** This is architecturally correct per `docs/PLAN.md` — "Out of scope: live trading" — but it is a hard blocker for any revenue-generating step.

### G3 — Data-plane keeper (event-store schema + provenance + volume columns)

- **Status:** 🟡 **MOVING**
- Schema migrations landed:
  - `markets` gained `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `yes_bid_size_fp`, `yes_ask_size_fp`
  - `events.location` now populated from Kalshi `sub_title`
  - `player_profiles` table created
- **Still open:** Full provenance columns (`source`, `source_url`, `fetched_ts`) are defined but not consistently backfilled on all historical rows.
- **Still open:** WS recorder lane is dead due to missing Kalshi API credentials.

### G4 — Shadow logs populated in alpha tenants

- **Status:** 🟡 **PARTIAL — game-model has lines; tour still empty**
- `alpha/tennis-game-model/shadow-log.jsonl`: **42 lines** appended via new `src/batch-shadow.ts` (74 ITF tickers with non-empty book_ticks processed; 42 had tradeable signal contexts that generated predictions). First real shadow predictions on record.
- `alpha/tennis-tour-pinnacle-novig/shadow-log.jsonl`: **still does not exist** — 0 tour-series events in event-store.db; REST-only batch runner `src/batch-shadow-rest.ts` is ready but has no data to process.
- Both `program.json` files reference `shadowLog: "shadow-log.jsonl"` and `src/shadow.ts` is ready to append (`appendShadowLine`).
- **Root cause (tour):** No ATP/WTA/Challenger events synced into event-store yet. When tour data arrives, `batch-shadow-rest.ts` will populate the log without needing Odds API.

- **Status:** 🔴 **EMPTY**
- `alpha/tennis-game-model/shadow-log.jsonl` — **does not exist**
- `alpha/tennis-tour-pinnacle-novig/shadow-log.jsonl` — **does not exist**
- Both `program.json` files reference `shadowLog: "shadow-log.jsonl"` and `src/shadow.ts` is ready to append (`appendShadowLine`).
- **Root cause:** Shadow lines require a `SignalContext` with a live book. The `tennis:record` REST ticks are stale, and WS ticks are blocked. No `run-watch.ts` or `run-once.ts` shadow batch has been executed.

### G5 — Odds API tour mapping + Pinnacle novig baseline

- **Status:** 🟡 **PARTIAL**
- `alpha/tennis-tour-pinnacle-novig/src/run-once.ts` was updated with `oddsSportFromTicker()` mapping Kalsi series prefix → Odds API sport key (`tennis_atp`, `tennis_wta`, `tennis_atp_challenger`).
- **Blocked:** `ODDS_API_KEY` is not set, so the tour tenant cannot fetch real Pinnacle lines.
- `bun run typecheck` is green after the mapping fix.

---

## 3. External Changes Detected

### Kalshi Fee Schedule

- **Verdict: NO CHANGE.** Taker rate remains `0.07`, maker rate `0.0175`.
- Multiple third-party reviews dated July 2026 confirm the same formula: `fee = 0.07 × C × P × (1 − P)`, capped at 1.75¢ per contract at 50¢.
- Our `src/institutions/kalshi-fees.ts` matches the live schedule.
- **One nuance:** Kalshi now lists ~105 specific series with non-standard maker fees (not free). ATP Tennis Match is flagged as one of them in fee-comparison tables. Our `kalshi-fees.ts` uses the generic maker rate; if ATP/WTA tour match series move to non-standard fees, our edge math will be off. **Action:** verify whether `KXATPMATCH` / `KXWTAMATCH` are in the non-standard list before first live trade.
- **Sources:** [kalshi.com/fee-schedule](https://kalshi.com/fee-schedule) (blocked by regional filter; verified via [predictionhunt.com](https://www.predictionhunt.com/blog/kalshi-fees-complete-guide-2026) and [bettorsinsider.com](https://bettorsinsider.com/predictions/reviews/kalshi/)), [docs.kalshi.com/fee_rounding](https://docs.kalshi.com/getting_started/fee_rounding)

### Tennis Series Availability

- **Verdict: STABLE.** All expected series are referenced in the codebase and appear in Kalshi's catalog:
  - `KXITFMATCH` / `KXITFWMATCH` — ITF (winners-only ladder today)
  - `KXATPMATCH` — ATP tour
  - `KXWTAMATCH` — WTA tour
  - `KXATPCHALLENGERMATCH` — ATP Challenger
  - `KXWTACHALLENGERMATCH` — WTA Challenger
- No evidence of series deprecation or renaming in the past week.
- **Note:** ITF still has no set/game ladder series (`KXITFSETWINNER`, etc.) per `TENNIS_PROGRAM_ARCHETYPES.md`. The recorder contract for full ladder coverage only applies to tour/Challenger families today.

### Regulatory / Structural News

- **CFTC proposal (July 2026):** The CFTC released a 267-page ANPRM that may restrict sports event contracts tied to "league officiating or athlete injuries." This is a forward risk, not an immediate block on tennis match-winner contracts.
- **Massachusetts:** Preliminary injunction against Kalshi sports contracts remains in effect. Appeal is fully briefed; oral argument expected H2 2026. This does not affect the bot's technical architecture but is a market-access risk for MA-based operators.
- **New Mexico:** CFTC sued NM in June 2026 (state attempting to regulate event contracts). Part of the broader state-vs-federal pattern.
- **Meta acquisition rumors:** Unsubstantiated; no technical impact.
- **Sportradar partnership:** Kalshi signed a multi-year data deal (MLB, NHL, MLS, UFC). Tennis was not explicitly named. Our data pipeline depends on ITF Stadion + Kalshi REST, not Sportradar, so no immediate impact.
- **Source:** [nextpredict.io](https://nextpredict.io/operators/kalshi/), [bleap.finance](https://www.bleap.finance/blog/best-prediction-market-platforms), [hklaw.com](https://www.hklaw.com/en/insights/publications/2026/02/prediction-markets-at-a-crossroads-the-continued-jurisdictional-battle)

---

## 4. Single Highest-Leverage Dev Step for the Coming Week

### Recommendation: Procure Kalshi API credentials + sync tour-series events

**What was executed during this review:**
- `alpha/tennis-game-model/src/batch-shadow.ts` built and run → **42 shadow-log lines** written.
- `alpha/tennis-tour-pinnacle-novig/src/batch-shadow-rest.ts` built → ready but idle (0 tour events in DB).

**What remains:**

1. **Procure `KALSHI_API_KEY_ID` + `KALSHI_PRIVATE_KEY_PATH`** — P0 unblock. Without these:
   - WS recorder cron is registered but never executes
   - Per-point book latency is too high for set/game ladder trading
   - Live shadow loop with real book updates cannot run

2. **Sync tour-series events** — run `bun run tennis:itf -- --sync` when ATP/WTA/Challenger markets are live on Kalshi, or add a separate tour sync CLI. The event-store currently only has ITF data.

3. **Run calibration watcher** on the 42 new game-model shadow lines to mark toxicity and resolve outcomes as events settle. This closes the loop from prediction → outcome → Brier score.

**Secondary:** Fix `GH_TOKEN` so `bun run rate-limit:status` works and the research pipeline can resume.

### Recommendation: Build the REST-only backtest / batch-shadow runner

**Why:** The WS recorder is blocked by missing Kalshi API credentials. That is a procurement/admin task, not a dev task. Rather than sit idle, the alpha tenants should consume the **1,696 existing REST book_ticks** and the **1,497 resolved outcomes** to produce the first real shadow-log lines.

**What to build:**

1. **`alpha/tennis-game-model/src/backtest.ts`** (exists but may need wiring)
   - Iterate over `book_ticks` for ITF match-winner markets where `source='kalshi-rest'`.
   - Reconstruct `SignalContext` at each tick using the stored book + `player_profiles`.
   - Run `game-model.ts` / `match-model.ts` to generate `p_model`.
   - Call `appendShadowLine()` to write the first lines to `shadow-log.jsonl`.
   - On resolution, call `buildToxicityMarkFields()` + outcome mapping.

2. **`alpha/tennis-tour-pinnacle-novig/src/backtest.ts`** (new)
   - Filter to tour-series markets (`KXATPMATCH`, `KXWTAMATCH`, etc.) that have REST book_ticks.
   - Use the opening-prior mid as the baseline (no Odds API needed for a first pass).
   - Generate shadow lines to prove the append pipeline.

3. **Batch runner:**
   ```bash
   cd alpha/tennis-game-model && bun src/backtest.ts --from=2026-07-20 --to=2026-07-27
   ```

**Acceptance criteria:**
- Both `shadow-log.jsonl` files exist and contain ≥1 line per tenant.
- `bun run typecheck` stays green.
- No live orders placed (shadow-only).

**Secondary (parallel track):** Procure `KALSHI_API_KEY_ID` + `KALSHI_PRIVATE_KEY_PATH` so the WS recorder can close the book_ticks coverage gap. Without WS, per-point book latency will be too high for set/game ladder trading.

---

## 5. Doc Status Updates

No unambiguous completions since last review warrant updating `docs/ROADMAP.md` or `docs/PLAN.md` status lines. The following remain blocked:

- `ROADMAP.md` Phase "V5 — Live MM happy path" → **blocked** (`code_search` multi-wave)
- `ROADMAP.md` Phase "4 — Bot scaffold" → **planned** (after V5)
- `MISS_TAXONOMY.md` Lane D — Data fill → **blocked** (multi-wave / wait)

**New item to track:** Add a row to `ROADMAP.md` blockers table for Kalshi API credential gap, or keep it in `data-plane-log.md` only.

---

*Report generated: 2026-07-27. Next review: 2026-08-03.*
