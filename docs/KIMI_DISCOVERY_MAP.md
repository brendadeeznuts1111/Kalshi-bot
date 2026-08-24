# Kimi discovery map + goals — path to a live Kalshi tennis bot

Compiled 2026-07-22 by two research agents (codebase map + external Kalshi/tennis research).
Companion to [`ROADMAP.md`](ROADMAP.md) (research pipeline) and [`TENNIS_PROGRAM_ARCHETYPES.md`](TENNIS_PROGRAM_ARCHETYPES.md) (tennis doctrine). This file is the **bridge to the execution + model planes**.

## 1. Where the repo actually is

**Data plane — genuinely built, holding real data:**

* Event-store SQLite (`research/cache/event-store.db`, 9 MB): 1,631 events, 1,952 markets, 1,712 book\_ticks, **1,153 ITF resolutions (training corpus)**, 654 event\_links (498 bridged), live\_scores/score\_snapshots seeded.

* ITF Stadion collector → corpus=trading with provenance; Kalshi ITF sync + retain lookback; surname-day-lane bridge (0 ambiguous).

* Live-scores poller + canary (5 green dry-runs); full-ladder recorder logic; WS orderbook recorder proven (2 sessions, 115 deltas, 0 seq gaps as of 2026-07-23 agent tennis) — **watch-set WS coverage gap**: 0/78 current watch tickers have fresh `kalshi-ws` rows; operator action `tennis:record -- --ws` + `tennis:record:ws:register`.

* RSA-PSS auth module `src/bot/kalshi-auth.ts` — **complete and tested**; WS market data already consumes it.

* Calibration watcher: Brier + stderr, toxicity, realized edge ¢/fill, hash-chain verification, graduation-proposal artifacts.

* Fee math SSOT `src/institutions/kalshi-fees.ts`; armed-live triple gate (manifest status + `--live` + `ALPHA_LIVE`).

**Model plane — zero.** No tennis `p_model` exists. 1,153 resolutions sit unused. Tour archetype has no ATP/WTA ticker-format module and no Odds API tennis wiring (`ticker-map.db` has 1 NBA row). Both tennis programs are hypothesis paper only — `alpha:init` never run for them. **Shadow signals: 0 lines on disk** (MLB/NBA tenants too).

**Execution plane — zero by design.** `src/bot/kalshi-client.ts` `placeOrder` is a deliberate throwing stub ("lift from market-making shortlist before --live"). No `/portfolio/orders` POST, cancel, f

| <br /> | <br /> | <br /> |
| :----- | :----- | :----- |
| <br /> | <br /> | <br /> |
| <br /> | <br /> | <br /> |

ills, positions, balance, or P&L reconciliation anywhere in `src/`. The named lift source is **blocked on GitHub `code_search` quota** (ROADMAP V5).

## 2. External research findings (2026-07-22, live API verified)

### Order entry
* **Order entry:** `POST /trade-api/v2/portfolio/orders` — `ticker/side/action/count/yes_price`, `client_order_id` idempotency, `post_only`, `reduce_only`, `buy_max_cost` (FoK market-with-protection), `cancel_order_on_pause`, `self_trade_prevention_type`. Auth = RSA-PSS/SHA-256 over `{ts}{METHOD}{path-no-query}` (matches our existing signer).

### Rate limits
* **Rate limits:** Create Order = **100 tokens**; Basic tier = 100 write-tokens/s ≈ **1 order/sec sustained**. 429s have no `Retry-After` → backoff with jitter. Apply for Advanced tier early.

### Fees (decisive)
* **Fees (decisive):** taker `ceil(0.07·C·P·(1−P))`; **KXATPMATCH/KXWTAMATCH makers pay 25% of taker; KXITFMATCH/KXATPCHALLENGERMATCH resting makers pay 0** (live `fee_type` fields). Resting-limit strategy on soft series is where fee edge + price edge overlap. **Current `kalshi-fees.ts` hardcodes maker 1.75% — must become per-series `fee_type`-driven before any live order.**

### Market shape
* **Market shape:** two binary markets per match (one per player), 1¢ tick; ITF pre-start walkover resolves **\$0.50 flat** (P\&L edge case); retirement after start → that side No; no evidence of per-point suspensions (unverified — design for continuous trading); top-of-book thin (hundreds–few thousand contracts), ITF thinner.

### Model consensus
* **Model consensus:** surface-Elo prior + point-level serve/return Markov in-play updater; benchmark vs Pinnacle de-vigged close; Challenger/ITF softest; in-play is a latency game — without a sub-second point feed, **pre-match / near-start entries are the realistic edge**.

### Ops/legal
* **Ops/legal:** automated trading permitted (no self-match); US-only, state-litigation volatile (MA injunction, MI TRO mid-2026) — bot must halt on market unavailability; archive per-series contract PDFs.
## 3. Strengths this project already has (build on these)

1. License-clean, provenance-tagged primary corpus (1,153 resolutions) — competitors train on Sackmann; we can audit ours.
2. Bridged Kalshi↔Stadion event identity — outcomes attach to book ticks, so **backtests on our own recorded books** are possible.
3. Calibration discipline (Brier, toxicity, hash-chained shadow logs, graduation gates with breadth requirements) — most retail bots never measure; ours is the measuring stick first.
4. Auth + WS transport done; fee-aware execution gate designed.
5. Two-archetype doctrine prevents laundering unmeasured risk into graduation.

## 4. Goals — staged, each with a proof gate

### G0 — Unblock the lift source (this week)

* Run `bun run rate-limit:status`; when `code_search` resets, `bun run research -- --dimension=market-making --export-audit`.

* Proof: green run + shortlist with a live order client to lift.

* **Parallel path (do not wait):** implement `POST /portfolio/orders` + cancel + fills + positions directly from Kalshi docs in `src/bot/kalshi-client.ts` behind the existing signer, **demo environment only** (`demo-api.kalshi.co`). The lift then becomes review material, not a blocker.

  **Done (2026-07-22):** `src/bot/kalshi-client.ts` is a real signed REST client — maker-first `post_only` creates with `client_order_id` idempotency, cancel/orders/fills/positions/balance readers, token-bucket governor (1 create/s) + jittered 429/5xx backoff, injectable fetch. **Demo env default** (`KALSHI_ENV=prod` additionally requires `KALSHI_PROD_ARMED=1`). Remaining: G4 demo reconciliation before any prod arming; GitHub lift source still optional review material.

### G1 — Instantiate tennis tenants + tour wiring (week 1–2)

* `bun run alpha:init` for `tennis-game-model` and `tennis-tour-pinnacle-novig`.

* ATP/WTA ticker-format module; Odds API tennis keys + `ticker-map.db` population for tour matches.

* Per-series fee types from live series metadata into `kalshi-fees.ts`.

* Proof: `bun run alpha:run -- --program=tennis-tour-pinnacle-novig --ticker=KXATPMATCH-… --fetch-book` produces a shadow line with Pinnacle no-vig `p_model`.

  **Done (2026-07-22):** both tenants born with hypotheses preserved and example gates committed (`minContracts: 5` on both manifests); shared `series-parse.ts` SSOT under `src/alpha/ticker-formats/` with ITF + tour (`tour.ts`: KXATPMATCH/KXWTAMATCH/KXATPCHALLENGERMATCH/KXWTACHALLENGERMATCH) modules; per-series fees in `kalshi-fees.ts` (`MAKER_FREE_SERIES` = ITF + Challenger, `makerRateForSeries` / `makerPassesThreshold`). **Remaining:** `ticker-map.db` population for tour matches and Odds API tennis keys in the tour tenant's signal — the proof command above is still blocked on those.

### G2 — Game model v1 (week 2–4) — the actual edge

* ~~Surface-blind prior trained on the 1,153-resolution Stadion corpus (rolling, no lookahead)~~ **Done (2026-07-22, P1-1):** `player-strengths.ts` — Beta-shrunk game/match win-rate strengths (K=60 game-units ≈ 3 matches, match win = 10 game-wins, corpus-measured unknown-player default 0.55); `self-prior.ts` — identity mapping via events.player_a/b ↔ markets.yes_side_label with ambiguity hard-fail; pre-match `p_model` = FIXED Markov recursion on `{pHoldYes, pHoldNo}` from strengths, replacing the market-mid echo (echo kept as an unblended component). Prior-quality harness `prior-backtest.ts` runs on all 1,145 completed singles resolutions (no book_ticks needed).
* **Corpus prior numbers (rolling as-of, no lookahead):** Brier **0.2056**, log-loss **0.6009** vs always-0.5 baseline 0.2500 / 0.6931 and favorite-by-games baseline 0.2044 / 0.5995; both-players-known subset (573 matches) Brier **0.1560** / LL 0.4979. Calibration monotone and mid-band well-calibrated; tails compressed (same-week form dominates the 3-day corpus — documented, K sensitivity in `player-strengths.ts`).
* **Remaining:** surface-split strengths (60% of rows are `surface='unknown'` — hook exists); longer corpus window (current span 2026-07-19→22 makes tail calibration unverifiable); tick coverage for the tick-joined backtest (only 2 book_ticks join resolutions today, both empty books — `backtest.ts` reports `insufficient`, a coverage fact); in-play Markov validation; graduation per existing hypothesis (400 signals, 80 events, mid-band calibration).
* Backtest on recorded book\_ticks + bridged resolutions before first shadow tick — wired (`backtest.ts` as-of aligned, vacuous = "no independent information", self-prior Brier in summary); awaiting tick data.

### G3 — Shadow data fortnight (week 3–6, overlaps G2)

* Toxicity loop + live shadow ticks on both tenants through real match windows; WS recorder continuous; outcomes resolved.

* **Measured (2026-07-23):** event-store `book_ticks=1875`; canary OK (39 watch, 0 live); WS recorder trend 2 sessions / 115 deltas / 0% gap sessions; watch-set `with_ws=0/78` — register OS cron + run `--ws` capture on current watch before shadow ticks.

* Proof: watcher emits non-stub baseline-report; `shadowMinSignals` on track (200 tour / 400 game-model); empirical Brier baseline exists (removes graduation blocker).

### G4 — Demo-execution pilot (after G1, before live)

* Order manager on demo env: `post_only` resting entries on ITF/Challenger (maker-free), `client_order_id` idempotency, fills/positions reconcile loop, token-bucket governor (1 order/s), kill switch on pause/unavailability.

* Proof: 1 week of demo fills reconciled against Kalshi portfolio with zero orphan orders.

### G5 — Live pilot (graduation-gated)

* Watcher graduation-proposal → human approval → manifest `live`, 5-contract caps, per-day loss limit, ITF/Challenger resting-maker entries only, pre-match/near-start only (no in-play taker).

* Proof: first realized-edge report after fees vs hypothesis thresholds; kill-recommendation honored automatically.

### Explicit non-goals (for now)

* In-play taker latency trading (no sub-second point feed — we'd be the slow side).

* ITF ladder markets (Kalshi lists winners only today).

* Merging the two archetypes into one tenant.

## 5. Immediate next actions (operator)

```bash
bun run check                                        # baseline green
bun run rate-limit:status                            # G0 preflight
bun run alpha:init tennis-game-model --dimension=sports-itf   # G1
bun run tennis:live -- --sync --loop                 # keep data plane aging (G3)
```

Open questions to verify before live: exact WS hostname for order entry, set-market ticketing (`KXATPSET` 404s today), market-order semantics (`buy_max_cost` vs first-class), current excluded-state list.
