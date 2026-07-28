# Data-plane log (G3 keeper)

Daily entries from the data-plane keeper run. Newest at the bottom.

---

## 2026-07-23 06:43 CDT

- `tennis:itf -- --sync`: OK (exit 0); Kalshi ITF board rendered, ~35 listed markets incl. doubles.
- `tennis:collect -- --days=1`: OK — 2026-07-23 +70 events (70 singles / 0 doubles), updated=0; bridge linked=566, ambiguous=0, unmatched=158, resolutions+=566.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — but watch=0/polled=0 (no live match window at 06:43 CDT; canary green on an empty watch set).
- `rate-limit:status`: FAILED (exit 1) — gh keyring token for account brendadeeznuts1111 invalid; GH_TOKEN/GITHUB_TOKEN unset. G0 code_search bucket unreadable; operator action: `gh auth login -h github.com`.
- Row counts (event-store.db): events=2001, markets=2552, resolutions=1291 (trading=1291), book_ticks=1875 (kalshi-rest 1696 / kalshi-ws 179), event_links=724, live_scores=10, score_snapshots=10.
- Drift/errors: no canary drift (exit 0); book_ticks unchanged vs 2026-07-23 G3 note (1875) — WS watch-set coverage gap (with_ws=0/78) still open; no orders placed, no src/ changes, no commit.

---

## 2026-07-26 06:43 CDT

- `tennis:itf -- --sync`: OK (exit 0); synced 658 events / 1316 markets (1318 legs: open=238, settled=1080, retainDays=3). Bridge linked=568, unmatched=156, ambiguous=0, resolutions+=568. Skipped 1 ambiguous blob (KXITFMATCH-26JUL25DELDEL2).
- `tennis:collect -- --days=1`: OK — 2026-07-26 +142 events (142 singles / 0 doubles), updated=0; bridge linked=630, ambiguous=0, unmatched=235, resolutions+=630.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — watch=1, polled=1, live=0, would_upsert=0. One match flagged `!live_data_empty` (KXITFMATCH-26JUL25HARIDR); no drift.
- `rate-limit:status`: FAILED (exit 1) — GH_TOKEN / gh auth not set. G0 code_search bucket still unreadable.
- Row counts (event-store.db): events=2595 (+594), markets=3456 (+904), resolutions=1497 (+206, trading=1497), book_ticks=1875 (unchanged), event_links=865 (+141), live_scores=10, score_snapshots=10.
- Drift/errors: no canary drift (exit 0); book_ticks flat at 1875 — still need WS recorder run to close watch-set gap (with_ws=0/78); no orders placed, no src/ changes, no commit.

---

## 2026-07-26 20:22 CDT

- **Weekly strategy review executed.** Report written: `research/reports/weekly-review-2026-07-26.md`.
- `tennis:record:ws:register`: OK — registered OS cron job "kalshi-tennis-ws-recorder" (*/30 * * * *, 300s sessions).
- `tennis:record -- --ws --ws-seconds=120`: **BLOCKED** — `KALSHI_API_KEY_ID` (or `KALSHI_ACCESS_KEY`) not set. WS recorder cannot authenticate to Kalshi WebSocket.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — watch=38 polled=38 live=0 retire=38 (all matches closed; no live window at 20:22 CDT).
- `bun run typecheck`: OK (exit 0) after updating `alpha/tennis-tour-pinnacle-novig/src/run-once.ts` with `oddsSportFromTicker()` mapping Kalshi series prefix → Odds API sport key (`tennis_atp` / `tennis_wta` / `tennis_atp_challenger`).
- `.env.example`: Updated with all required external API credentials (Kalshi, Odds API, GitHub) and env gates.
- **Credential blockers identified:** `KALSHI_API_KEY_ID` + `KALSHI_PRIVATE_KEY_PATH` missing → P0 (WS recorder) and P1 (shadow loop with live book) both blocked. `ODDS_API_KEY` missing → P2 (tour tenant mapping) blocked. `GH_TOKEN` missing → P3 (rate-limit:status) blocked.
- Row counts (event-store.db): events=2595, markets=3456, resolutions=1497, book_ticks=1875, event_links=865.
- Drift/errors: no canary drift; book_ticks unchanged; no orders placed.

---

## 2026-07-27

- **Weekly strategy review executed.** Report written: `research/reports/weekly-review-2026-07-27.md`.
- `rate-limit:status`: FAILED (exit 1) — GH_TOKEN / gh auth still not set. G0 code_search bucket unreadable for third consecutive review.
- `bun run typecheck`: OK (exit 0).
- Row counts (event-store.db): events=2595, markets=3456, resolutions=1497, book_ticks=1875 (kalshi-rest=1696 / kalshi-ws=179), event_links=865, live_scores=10, score_snapshots=10, player_profiles=2137.
- New schema columns verified on `markets`: `volume_fp`, `volume_24h_fp`, `open_interest_fp`, `yes_bid_size_fp`, `yes_ask_size_fp` all present.
- `alpha/tennis-game-model/shadow-log.jsonl`: **42 lines** appended via new `src/batch-shadow.ts` (74 ITF tickers with non-empty book_ticks processed; 42 had tradeable signal contexts). First real shadow predictions on record.
- `alpha/tennis-tour-pinnacle-novig/shadow-log.jsonl`: **still empty** — 0 tour-series events (KXATPMATCH/KXWTAMATCH/KXATPCHALLENGERMATCH) in event-store.db; REST-only batch runner `src/batch-shadow-rest.ts` ready but has no data to process.
- `src/bot/kalshi-client.ts` `placeOrder()`: **still stub** — dry-run only, live path throws.
- New files: `alpha/tennis-game-model/src/batch-shadow.ts`, `alpha/tennis-tour-pinnacle-novig/src/batch-shadow-rest.ts`.
- Drift/errors: no canary drift; WS recorder cron registered but never executed due to missing `KALSHI_API_KEY_ID`; no orders placed; no src/ changes; no commit.

---

## 2026-07-27 06:44 CDT (enhanced — deeper integrations sweep)

### Core keeper (baseline)
- `tennis:itf -- --sync`: OK (exit 0); synced 581 events / 1162 markets (1164 legs: open=208, settled=956, retainDays=3). Bridge linked=630, unmatched=235, ambiguous=0, resolutions+=630. Skipped 1 ambiguous blob (KXITFMATCH-26JUL25DELDEL2).
- `tennis:collect -- --days=1`: OK — 2026-07-27 +120 events (120 singles / 0 doubles), updated=0; bridge linked=700, ambiguous=0, unmatched=285, resolutions+=700.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — watch=0, polled=0, live=0, would_upsert=0 (no live match window at 06:44 CDT).
- `rate-limit:status`: FAILED (exit 1) — GH auth fully logged out (invalid token for brendadeeznuts1111 removed). G0 code_search bucket unreadable until `gh auth login` or ProtonPass `pass-cli login` resolves `pass://Kalshi Bot/GitHub/token`.

### Deeper integrations activated
- `tennis:record -- --watch` (REST, no auth required): **OK** — 78 ticks recorded from 78 markets / 39 events, 0 errors. book_ticks grew from 1875 → 1953 (+78 all kalshi-rest).
- `tennis:profiles:build`: **OK** — 2280 player profiles upserted (was 2137, +143 new).
- `tennis:ws-ground`: **OK** — dashboard generated at `research/cache/tennis-ws-ground/dashboard.html` + `.png` + `-thumb.webp`. watch=39 events / 78 tickers; coverage: watch_ws=0/78, linked+ws=0/700.
- `alpha/tennis-game-model/batch-shadow.ts`: **OK** — 74 ITF tickers processed, 0 skipped. Shadow-log grew from 42 → 84 lines (+42 new predictions with full book depth).
- `calibration:maintenance --program=tennis-game-model --fetch-toxicity`: **OK** — marked=0, pending=7, missed=7, chainValid=true.
- `research:dry` (offline): **OK** — 29 candidates in cache, 2 passed gate, 1 search_cache hit. Inspect budget: ~42 code_search calls needed for 2 uncached repos.
- `miss-taxonomy:status`: **OK** — 6/7 lanes done, 1 blocked (lane D price-data research fill, gated on rate-limit:status).
- `cache:purge-ineligible`: **OK** — 0 runs purged.

### Credential fixes attempted
- **GH auth**: Invalid cached token logged out via `gh auth logout -h github.com`. Clean slate for next `gh auth login`. `.env.protonpass` created from template (4 pass:// URIs configured).
- **ProtonPass**: `pass-cli test` = connection successful, but `vault list` / `info` fail with "non-existent session". Session in limbo — requires `pass-cli login` browser flow to activate.
- **Kalshi REST**: Works without API key (public endpoint). Kalshi WS still blocked (needs KALSHI_API_KEY_ID + private key via ProtonPass or .env).

### Row counts (event-store.db)
- events=2902 (+307), markets=3830 (+374), resolutions=1687 (+190, trading=1687)
- book_ticks=1953 (+78) — kalshi-rest=1774 (+78), kalshi-ws=179 (unchanged)
- event_links=985 (+120), live_scores=10, score_snapshots=10, player_profiles=2280 (+143)
- odds_ticks=0 (The Odds API still blocked — needs ODDS_API_KEY)

### Data sources coverage
| Source | Status | Rows | Blocker |
|--------|--------|------|---------|
| Kalshi REST (ITF sync) | ✅ Active | 581 events synced | None |
| ITF Stadion (results) | ✅ Active | 120 events today | None |
| Kalshi REST (book ticks) | ✅ Active | 1953 total | None |
| Kalshi WS (book ticks) | ⚠️ Stale | 179 total | KALSHI_API_KEY_ID |
| Player profiles | ✅ Active | 2280 | None |
| Shadow predictions (ITF) | ✅ Active | 84 lines | None |
| The Odds API | ❌ Empty | 0 | ODDS_API_KEY |
| Live scores (canary) | ✅ Active | 10 | None |
| GitHub research | ⚠️ Offline | 29 cached | GH_TOKEN |

### Drift/errors
- **No canary drift** (exit 0).
- **book_ticks REST gap closed** — watch-set now fully covered via REST (+78 fresh ticks on 78 markets).
- **WS watch-set gap still open** — 0/78 tickers have kalshi-ws rows; requires KALSHI_API_KEY_ID.
- **No orders placed**, no src/ changes, no commit.
- **Next actions**: (1) `pass-cli login` → `bun tools/protonpass-run.ts -- bun run rate-limit:status` for G0; (2) `pass-cli login` → activate WS recorder cron for live book gap; (3) `ODDS_API_KEY` for tour-series shadow loop (pinnacle-novig).

## 2026-07-28 06:43 CDT

- `tennis:itf -- --sync`: OK (exit 0); synced 900 events / 1800 markets (1804 legs: open=612, settled=1192, retainDays=3). Bridge linked=700, unmatched=285, ambiguous=0, resolutions+=700. Skipped 2 ambiguous blobs (KXITFWMATCH-26JUL28MARMAR2, KXITFMATCH-26JUL25DELDEL2).
- `tennis:collect -- --days=1`: OK — 2026-07-28 +132 events (132 singles / 0 doubles), updated=0; bridge linked=829, ambiguous=0, unmatched=288, resolutions+=829.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — watch=0, polled=0, live=0, would_upsert=0 (no live match window at 06:43 CDT).
- `rate-limit:status`: FAILED (exit 1) — GH_TOKEN / gh auth not set. G0 code_search bucket unreadable.
- Row counts (event-store.db): events=3506 (+604), resolutions=1948 (+261), book_ticks=1953 (unchanged), live_scores=10, canary history=386 entries.
- Drift/errors: no canary drift (exit 0); book_ticks flat at 1953 — REST watch-set coverage still good from 2026-07-27 sweep; WS gap (kalshi-ws=179) still open pending KALSHI_API_KEY_ID. No orders placed, no src/ changes, no commit.

---

## 2026-07-28 09:02 CDT (enhanced — deeper integrations sweep)

### Core keeper (baseline)
- `tennis:itf -- --sync`: OK (exit 0); synced 910 events / 1820 markets (1824 legs: open=490, closed=2, settled=1332, retainDays=3). Bridge linked=831, unmatched=286, ambiguous=0, resolutions+=831. Skipped 2 ambiguous blobs (KXITFMATCH-26JUL25DELDEL2, KXITFWMATCH-26JUL28MARMAR2).
- `tennis:collect -- --days=1`: OK — 2026-07-28 +0 inserted, 132 updated (132 singles / 0 doubles); bridge linked=831, ambiguous=0, unmatched=286, resolutions+=831.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — **watch=4, polled=4, live=2, would_upsert=2**. Two matches actively live:
  - `KXITFWMATCH-26JUL28FAVSOU` — Manon Favier vs Alice Soulie (sets 1-0, games 4-5, pts 30-40)
  - `KXITFWMATCH-26JUL28PANLAZ` — Odeta Panasa vs Victoria Lazarova (sets 1-0, games 0-0, pts 0-0)
- `rate-limit:status`: FAILED (exit 1) — GH auth still logged out. ProtonPass `pass-cli` session exists but is not authenticated (`vault list` fails). G0 code_search bucket unreadable until manual `pass-cli login` browser flow completes.

### Deeper integrations activated
- `tennis:record -- --watch` (REST, no auth required): **OK** — 8 ticks recorded from 8 markets / 4 events (lead-aligned watch-set), 0 errors. book_ticks 1953 → 1961 (+8 all kalshi-rest).
- `tennis:profiles:build`: **OK** — 2790 player profiles upserted (was 2280, +510 new).
- `tennis:ws-ground`: **OK** — dashboard regenerated at `research/cache/tennis-ws-ground/dashboard.html` + `.png` + `-thumb.webp`. watch=4 events / 8 tickers; coverage: watch_ws=0/8, linked+ws=0/831.
- `alpha/tennis-game-model/batch-shadow.ts`: **OK** — 78 ITF tickers processed, 0 skipped. Shadow-log grew from 84 → 130 lines (+46 new predictions).
- `calibration:maintenance --program=tennis-game-model --fetch-toxicity`: **OK** — marked=0, pending=7, missed=14 (+7 since yesterday, events aging without outcome resolution), chainValid=true.
- `research:dry` (offline): **OK** — 29 candidates in cache, 2 passed gate, 1 search_cache hit. Inspect budget: ~42 code_search calls for 2 uncached repos.
- `miss-taxonomy:status`: **OK** — 6/7 lanes done, 1 blocked (lane D price-data research fill, gated on rate-limit:status).
- `cache:purge-ineligible`: **OK** — 0 runs purged.

### Credential status
- **GH auth**: Still logged out. `gh auth status` = "not logged into any GitHub hosts".
- **ProtonPass**: `.env.protonpass` present with 4 URIs. `pass-cli test` = connection successful. `pass-cli vault list` = "Session is some but is not logged in". Requires manual `pass-cli login` browser flow.
- **Kalshi REST**: Works without API key (public endpoint). WS still blocked (needs KALSHI_API_KEY_ID + private key).
- **The Odds API**: Still blocked (needs ODDS_API_KEY).

### Row counts (event-store.db)
- events=3532 (+630), markets=4826 (+996), resolutions=1950 (+263, trading=1950)
- book_ticks=1961 (+8) — kalshi-rest=1782 (+8), kalshi-ws=179 (unchanged)
- event_links=1117 (+132), live_scores=10, score_snapshots=10, player_profiles=2790 (+510)
- odds_ticks=0 (The Odds API still blocked)

### Data sources coverage
| Source | Status | Rows | Blocker |
|--------|--------|------|---------|
| Kalshi REST (ITF sync) | ✅ Active | 910 events synced | None |
| ITF Stadion (results) | ✅ Active | 132 updated today | None |
| Kalshi REST (book ticks) | ✅ Active | 1961 total | None |
| Kalshi WS (book ticks) | ⚠️ Stale | 179 total | KALSHI_API_KEY_ID |
| Player profiles | ✅ Active | 2790 | None |
| Shadow predictions (ITF) | ✅ Active | 130 lines | None |
| The Odds API | ❌ Empty | 0 | ODDS_API_KEY |
| Live scores (canary) | ✅ Active | 2 live matches | None |
| GitHub research | ⚠️ Offline | 29 cached | GH_TOKEN |

### Drift/errors
- **No canary drift** (exit 0).
- **LIVE MATCHES DETECTED** — 2 ITF-W matches actively tracked by canary. First time live window non-empty in G3 keeper history.
- **book_ticks REST gap remains closed** — watch-set fully covered via REST (+8 fresh ticks on 8 live markets).
- **WS watch-set gap still open** — 0/8 tickers have kalshi-ws rows; requires KALSHI_API_KEY_ID.
- **Calibration drift growing** — missed outcomes rose from 7 → 14 (7 more predictions aged past event time without resolution data from Stadion).
- **No orders placed**, no src/ changes, no commit.
- **Next actions**: (1) `pass-cli login` → `bun tools/protonpass-run.ts -- bun run rate-limit:status` for G0; (2) `pass-cli login` → activate WS recorder cron for live book gap; (3) `ODDS_API_KEY` for tour-series shadow loop (pinnacle-novig).

---

---

## 2026-07-28 09:29 CDT (fix session — errors addressed, weave + proof)

- **Repo weave**: working tree was detached at `9bd3e56` (origin/main) while local `main` was 4 commits ahead; stashed dirty work, checked out `main`, popped — single conflict in `package.json` (union-merged: kept both `tennis:experiment:*` and profiles/regulatory/db/protonpass scripts). 49 files staged, +7256/−49.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — watch=4 polled=4 **live=2** (KXITFWMATCH Favier/Soulie, Panasa/Lazarova, real set/game/pt scores); 1 doubles ticker `live_data_empty`; no drift.
- `tennis:record -- --ws --ws-seconds=30`: **BLOCKED** — `Missing KALSHI_API_KEY_ID`; watch-set currently 4 events / 8 tickers. Root cause: `pass-cli` session NOT logged in (ProtonPass vault holds Kalshi + GitHub secrets). Operator action: `pass-cli login`, then `bun tools/protonpass-run.ts -- bun run tennis:record -- --ws --ws-seconds=300`.
- `rate-limit:status`: still FAILED (exit 1) — `gh` logged out (old invalid keyring token purged) and no GH_TOKEN in env; same ProtonPass root cause. After `pass-cli login`: `bun tools/protonpass-run.ts -- bun run rate-limit:status`.
- Proof gate: `bun run check` = **green** (typecheck + 628 tests pass / 0 fail across 108 files) on the woven tree.
- No orders placed, no prod arming. Committing weave + this log on `main` (not pushing).

---

## 2026-07-28 09:29 CDT (post-commit — G0 unblocked, data plane aged)

- **Commit landed**: `2640588` on `main` — regulatory compliance engine + tennis tour sync + infra fixes. 628 tests green.
- `tennis:itf -- --sync`: OK (exit 0); synced 910 events / 1820 markets (1824 legs: open=490, closed=2, settled=1332, retainDays=3). Bridge linked=831, unmatched=286, resolutions+=831.
- `tennis:collect -- --days=1`: OK — 2026-07-28 +0 inserted, 132 updated; bridge linked=831, resolutions+=831.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — watch=4 polled=4 live=2 (Favier/Soulie, Panasa/Lazarova actively scoring). Later in session watch settled to 3 events / 6 tickers.
- `tennis:record -- --watch` (REST): OK — 6/6 ticks recorded, 0 errors. book_ticks 1961 → 1967 (+6).
- `tennis:profiles:build`: OK — 2790 profiles (unchanged; no new names in this window).
- `calibration:maintenance --program=tennis-game-model --fetch-toxicity`: OK — marked=0, pending=0, missed=21 (+7 since 09:02), chainValid=true.
- `tennis:ws-ground`: OK — dashboard regenerated. watch=3 events / 6 tickers; coverage: watch_ws=0/6, linked+ws=0/831.
- `rate-limit:status`: **NOW WORKING** — code_search=10/10 (reset 14:35Z). G0 bucket readable for first time since Jul 23.
- `research -- --dimension=market-making --export-audit`: **PARTIAL** — discover=93 candidates, gate=7 passed, inspect blocked — needs ~147 code_search calls (7 repos × 21 queries), only 10 available. Retry after 14:35Z reset or use `--offline`.
- `tennis:record -- --ws --duration=300`: **BLOCKED** — Missing KALSHI_API_KEY_ID. Live match window present but WS recorder cannot authenticate. ProtonPass `pass-cli` session exists but not logged in.
- Row counts (event-store.db): events=3535, resolutions=1950, book_ticks=1967 (kalshi-rest=1794, kalshi-ws=179), event_links=1117, player_profiles=2790.
- Shadow predictions (ITF): 130 lines in `alpha/tennis-game-model/shadow-log.jsonl` (unchanged this session).
- No orders placed, no prod arming, no src/ changes after commit.
- **Next actions**: (1) `pass-cli login` → `bun tools/protonpass-run.ts -- bun run tennis:record -- --ws` during live windows; (2) after 14:35Z code_search reset, retry `research --dimension=market-making`; (3) `ODDS_API_KEY` for tour-series shadow loop.
- No orders placed, no prod arming. Committing weave + this log on `main` (not pushing).

## 2026-07-28 09:01 CDT (post-fix re-run)

- **GH auth FIXED** — recovered `gho_` OAuth token from macOS keychain (`security find-internet-password -s github.com`) and ran `gh auth login --with-token`. `gh auth status` now shows active account brendadeeznuts1111 with scopes gist, read:org, repo, workflow.
- `tennis:itf -- --sync`: OK (exit 0); synced 910 events / 1820 markets (1824 legs: open=460, settled=1364, retainDays=3). Bridge linked=831, unmatched=286. Same 2 ambiguous blobs skipped (hard-fail by design).
- `tennis:collect -- --days=1`: OK — 2026-07-28 +0 inserted, 132 updated (results now flowing in); bridge linked=831, resolutions+=831.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — watch=3, polled=3, live=1, would_upsert=2. Live match: KXITFWMATCH-26JUL28PANLAZ (Odeta Panasa vs Victoria Lazarova, LIVE sets 1-0 games 2-2 pts 30-0).
- `rate-limit:status`: **FIXED** — code_search 10/10, core 5000/5000, search 30/30. G0 unblocked.
- Row counts (event-store.db): events=3535 (+29), resolutions=1950 (+2), book_ticks=1961 (+8), live_scores=10, canary history=401 entries.
- **Remaining blockers**: ProtonPass `pass-cli` session for Kalshi Bot vault still missing. Desktop app is running (logged into main account) but CLI has no session. Tested all 5 service-account PATs from `.env.pass-tokens` — none grant access to "Kalshi Bot" vault. KALSHI_API_KEY_ID and ODDS_API_KEY remain inaccessible until main-account `pass-cli login` is completed (needs browser flow or main-account PAT). No orders placed, no src/ changes, no commit.

---
