---
name: plan
description: >-
  Plans Kalshi sports-bot work beyond harness plumbing: independent probability
  model (α), ticker mapping, fee-aware edge, liquidity-sized execution, bankroll
  and correlation controls, and shadow calibration before live size. Use when
  the user invokes /plan, asks what to build next after the harness, or needs
  the sports-bot build order and next steps.
disable-model-invocation: true
---

# Plan

When invoked, use the doctrine below as the source of truth for prioritization
and next steps. Do not treat harness plumbing (auth, signing, orders, WebSocket,
safety flags) as alpha. Lift engineering; expect zero edge from public repos.
Recommend concrete actions in build order; prefer `odds-feed` dimension runs (quota-windowed) in parallel with hand-built `src/alpha/` work — not serial "research then scaffold."

## Build status (2026-07-22)

| Layer | Status | Location |
|---|---|---|
| Fee SSOT (ceil, MIN_CONTRACTS=5) | **Done** | `src/institutions/kalshi-fees.ts` |
| Odds client (Pinnacle, ETag cache) | **Done** | `src/alpha/odds-feed.ts` |
| Ticker mapper + hard-fail validation | **Done** | `src/alpha/ticker-mapper.ts`, `research/ticker-overrides.json` |
| Signal wiring (odds → mapper → context) | **Done** | `src/alpha/signal-context.ts` |
| Alpha tenant template | **Done** | `.bun-create/alpha-program/` (sole SSOT) |
| First baseline tenant (NBA, Oct+) | **Born** | `alpha/pinnacle-novig-nba/` — idle until `KXNBAGAME` season |
| **Live baseline (Jul–Sep)** | **Born** | `alpha/pinnacle-novig-mlb/` — `KXMLBGAME` + `baseball_mlb` |
| Calibration institution | **Done** | `src/calibration/watcher.ts`, `shadow-maintenance.ts` |
| Kalshi orderbook fetch (public) | **Done** | `src/bot/kalshi-market-data.ts` — reciprocal bid→ask; crossed-book skip |
| Append-only shadow log | **Done** | Predictions immutable; `toxicity-mark` + `outcome-resolution` entries chained after |
| Toxicity 60s marking | **Done** | `calibration:toxicity:loop` (15s sweep, T+60s window); `--fetch` for one-off |
| Outcome resolution → Brier | **Done** | `calibration:resolve-outcomes` — append-only `outcome-resolution` lines |
| Empirical baseline Brier | **Done** | `baselineBrierScore()` from `pinnacle_novig_*` components |
| Live Kalshi orders | **Stub** | `src/bot/kalshi-client.ts` — dry-run only |

**Active phase:** live shadow clock — `ODDS_API_KEY` → live tick → **toxicity loop running** → volume → outcomes last.

**Sequencing gate:** `--offline` uses fixture odds — hash-chained calibration data about a model that never existed. Baseline `pModel` *is* live Pinnacle novig; the odds key is in front of everything, not item 3.

## Kalshi book semantics (load-bearing)

Kalshi GET `/markets/{ticker}/orderbook` returns **bids only** — no asks. Binary reciprocity:

```
YES bid at P  ↔  someone willing to buy YES at P
NO  bid at Q  ↔  YES ask at (100 − Q) cents
```

Code: `src/bot/kalshi-book-parse.ts` → interior `BookSnapshot` with `bids[]` (YES) and `asks[]` (derived). Wire arrays are ascending (best bid = last); parser normalizes to best-first. **Never** treat displayed Kalshi price as fillable without walking derived depth. Top-of-book optimism is the main shadow/live gap.

**Crossed book:** transient `yesBid + noBid > 100` → `book.crossed`, skip tick (logged anomaly), no mid/VWAP. Rare; prevents phantom fills at impossible prices.

Toxicity marking compares `midAtFillCents` (at signal) vs mid fetched in the **T+60s window** (60–75s post-fill) — not hours later. Manual `mark-toxicity` outside that window produces wrong data, not late data.

## Shadow log integrity (append-only)

Prediction lines are **never rewritten**. Toxicity marks and outcome resolutions are **new chained entries** referencing `refLineHash` or `eventId`. Watcher joins at read time via `materializeShadowLines()`.

**Reject:** in-place log edits + hash recomputation — that normalizes editing the commitment log. Legitimate late data (toxicity, outcomes) arrives as append-only entries only.

## Shadow maintenance loop

```
ODDS_API_KEY set
        ↓
alpha:run (--fetch-book, NO --offline)  →  append prediction line (kind=prediction)
        ↓  toxicity loop must be running
calibration:toxicity:loop               →  append toxicity-mark at T+60s (15s window)
        ↓ game ends (last — blocks nothing)
calibration:resolve-outcomes            →  append outcome-resolution → Brier
        ↓ weekly
calibration:watcher                       →  graduation / kill / baseline artifacts
```

**Toxicity scheduling (pick one while shadow-running):**

```bash
bun run calibration:toxicity:loop              # in-process, every 15s (preferred during sessions)
bun run calibration:toxicity:register          # OS cron every minute (background daemon)
```

One-off mid pull (only valid inside T+60s window): `bun run calibration:mark-toxicity -- --program=pinnacle-novig-nba --fetch`

Combined maintenance (outcomes + optional fetch): `bun run calibration:maintenance -- --program=pinnacle-novig-nba --fetch-toxicity --resolve=outcomes.json`

**Do not use `--force-due` outside tests** — marks outside the 60s window are systematically wrong.

**Graduation guard:** watcher refuses graduation proposals while `empiricalBaselineBrier == null` (0.25 stub) or `role === "baseline"`. Stub that silently certifies is worse than no baseline — baseline-reports and kill-recommendations still emit.

## Institutions vs alpha programs

The harness is the **institution layer** — it governs edge work; it is not the alpha engine. Four permanent institutions (alpha-agnostic; no imports from `src/alpha/`):

| Institution | Role | Repo today |
|---|---|---|
| **Scoring** | Factor stack + detectors on any code corpus | `src/research/score.ts`, `evidence.ts`, `feeAware` (7th detector) |
| **Evidence chain** | Hash + audit export; commit claims before outcomes | `export-audit.ts`, `evidenceFingerprint` — GitHub repos only; shadow predictions get local `Bun.hash` chain, not rotor bridge |
| **Pattern library** | Extraction over corpora | `src/agent/pattern-extract.ts` — odds/vig/fee patterns; **second corpus type** (trade/shadow logs) is inward expansion, not `--dimension=self` |
| **Calibration** | Shadow/live logs → Brier sanity, realized edge, drift → artifacts | `src/calibration/watcher.ts` — **not** a research dimension |

An **alpha program** is a disposable tenant plugging into all four. Contract:

```
hypothesis       → why the edge exists, who loses on the other side (Q2 is the filter)
signal spec      → mandatory components; every skip has reason
shadow phase     → 2–4 weeks, depth-walked fills, hashed predictions
calibration gate → realized edge after fees (graduation) + Brier (sanity/kill)
graduation       → pilot (tiny size) → ratchet, or kill — both exported artifacts
```

**Kill artifacts are first-class.** Zombie strategies die when calibration watcher files a kill recommendation against pre-committed `killBrierDriftPct`, not when PnL quietly fades.

### Graduation gates — two eyes (do not regress)

| Gate field | Role | Default |
|---|---|---|
| `graduationMinRealizedEdgeCentsPerFill` | **Primary** — mean cents/contract after fees at VWAP fill | 2 |
| `graduationMinFills` | Minimum fills before edge gate | 30 |
| `graduationMinDistinctEvents` | Minimum distinct resolved `eventId`s (anti tick-spam) | 40 |
| `shadowMinSignals` + `killBrierDriftPct` | **Brier sanity** — detects gross miscalibration, not incremental edge | 100 / 15% |
| `shadowMinWeeks` | Regime exposure | 3 |

Brier at 0.5 on fair coins is **exactly 0.25** — not a variance floor. At n=100, Brier certifies ~10-point systematic error, not 1–2 point edge over Pinnacle. **Never graduate on Brier alone.**

### Expansion order (marginal edge per unit of work)

1. **Sharp-consensus baseline** (Pinnacle no-vig) — `alpha/pinnacle-novig-nba` is the unit of account
2. **Execution quality** — fills, queue, slippage at size; MM/arb lift map feeds this
3. **One proprietary signal** — kick-off/toss α; one only until calibrated
4. **Cross-venue arb** (Kalshi ↔ Polymarket) — after execution proven
5. **Sports market making** — last; needs everything above solid

### How the harness grows (without eating alpha)

- **Dimensions** expand horizontally in `dimensions.json` only (`odds-feed` live; future `polymarket-sports`). Fix abstractions once — don't bolt alpha into harness.
- **Pattern extraction** adds corpus types (repos | logs), not research dimensions for your own bot.
- **Agents** are operators over artifacts: Scout, Critic, **Calibration watcher** (drift → kill rec), Discovery (dry dimensions). Each output is auditable.

### Invariants

1. **No alpha code in the harness** — detectors score repos; they never import `src/alpha/`.
2. **Same gauntlet for every program** — no "obvious edge" bypass.
3. **~20% fixed harness slice** — calibration tooling, detectors, evidence; not only when alpha is stuck.
4. **Graduations and kills both exported** — honest memory compounds.

**Reject:** `ticker-mapper` / `shadow-bot` as research dimensions; calibration as a dimension; `--dimension=self`; rotor re-bridge for shadow log; duplicate template under `src/alpha/template/`.

**Alpha program tenant:** `bun create alpha-program alpha/<name> --no-git` (always `--no-git`). Template SSOT: `.bun-create/alpha-program/` only. First act: complete `hypothesis.md`.

**One line:** the harness makes edge *cumulative* — every experiment leaves a scored pattern, a calibration point, or a proven kill. Alpha programs are disposable; the record of what you know is not.

## Locked conventions (do not regress)

**Fee math — single convention, no double-count:**

```
raw_edge = p_model − kalshi_price
trade iff raw_edge > fees(price) + slippage_margin
```

Never subtract fees in the edge definition *and* again in the threshold. Shadow log stores `rawEdgeCents`, `feePerContractCents`, and VWAP fill separately.

**Fee schedule SSOT:** [kalshi.com/fee-schedule](https://kalshi.com/fee-schedule). Code: `src/institutions/kalshi-fees.ts` — cent math with `ceil`, `MIN_CONTRACTS=5`.

**Sharp consensus source:** Pinnacle via The Odds API. Bookmaker.eu cross-check only. Log timestamp + limit context on every snapshot.

**Shadow fills walk the book:** `simulateFillVwap` on depth; partial fills honest; toxicity via append-only `toxicity-mark` entries in the T+60s window (loop required).

**Known gap:** `realizedEdgeCentsPerFill` models **entry fee only** — round-trip exit fee not yet subtracted. Graduation edge gate is optimistic until fixed.

**Sequencing:** `ODDS_API_KEY` → live tick → toxicity loop → volume → outcomes. `odds-feed` dimension when quota allows (parallel validation, not a blocker). Baseline engine in `src/alpha/` is **product code**, not blocked on lift map.

**Deprioritize:** Kalshi-only sports scraping; harness completeness as readiness to size; research dimensions for bespoke glue; scoring your own bot with GitHub factor stack.

---

## Build order (what remains)

Public repos answer plumbing. They do not answer α.

| # | Item | Status | Next action |
|---|---|---|---|
| 1 | Probability model (Pinnacle novig v1) | **Wired** | Collect shadow lines; verify realized edge distribution |
| 2 | Ticker mapper + validation | **Wired** | Add overrides as new KXNBAGAME tickers appear |
| 3 | Fee-aware edge | **Done** | — |
| 4 | Execution at real liquidity | **Partial** | `--fetch-book` live; lift auth client for orders |
| 5 | Bankroll / event exposure | Partial | `exposure.ts` caps per eventId; extend to correlated markets |
| 6 | Calibration loop | **Live** | Toxicity loop during shadow; auto settlement (next); round-trip fees in edge metric (next) |

## Execute now (priority order)

1. **`ODDS_API_KEY`** — live Pinnacle; `--offline` is dev-only plumbing check, not baseline data.
2. **Live shadow tick** — `bun run alpha:run -- --program=pinnacle-novig-mlb --ticker=KXMLBGAME-... --fetch-book`
3. **Toxicity loop running** (separate terminal before step 2) — `bun run calibration:toxicity:loop`
4. **Volume** — repeat 2+3 across games; discard any fixture/offline shadow lines.
5. **After games** — `calibration:resolve-outcomes` or `--resolve=` on maintenance (~30s manual).
6. **Weekly** — `calibration:watcher` — check `empiricalBaselineBrier` in artifacts, not placeholder 0.25.
7. **Ticker overrides** — `research/ticker-overrides.json` for each new `KXNBAGAME` ticker.
8. **Parallel research** — `bun run research -- --dimension=odds-feed --dry-run` (validation, not blocker).
9. **Lift live client** — `src/bot/kalshi-client.ts` before `--live`.

**Do not:** size live; graduate on Brier alone; fork the template to `src/alpha/template/`.

The harness answered "how do public bots talk to Kalshi." The remaining question: "does Pinnacle novig minus Kalshi price survive fees at our size?" — that answer lives in the shadow log, not in another research run.
