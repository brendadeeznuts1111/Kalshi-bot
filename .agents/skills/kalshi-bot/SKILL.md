---
name: kalshi-bot
description: >
  Kalshi GitHub Bot Research Agent — Bun-native Kalshi trading bot discovery,
  scoring, and alpha program harness. Zero runtime npm deps. Uses Bun + gh CLI
  for research pipeline (discover → gate → inspect → score → report), alpha
  shadow trading baselines (MLB, NBA, tennis), calibration loop (toxicity →
  outcomes → Brier → watcher), and tennis event-store institution (ITF bridge,
  WS orderbook recorder, WebView ground). Trigger when working with Kalshi
  markets, shadow trading, bot research, alpha program tenants, calibration
  tooling, tennis event-store, or Bun-native CLI tools in this repo.
---

# Kalshi Bot Research Agent

Bun-native project for discovering and ranking public Kalshi trading bots on GitHub, plus a live alpha harness for sports-betting edge verification.

## Canonical docs (read first — do not duplicate)

| Resource | Path |
|----------|------|
| README (setup, scripts, layout) | `README.md` |
| Agent CLI sub-agents | `docs/AGENT.md` |
| Roadmap, blockers, proof gates | `docs/ROADMAP.md` |
| Build order, alpha doctrine, graduation gates | `.cursor/skills/plan/SKILL.md` |
| Bun-native API map | `docs/BUN_NATIVE.md` |
| Bun shell patterns | `docs/BUN_SHELL.md` |
| Pipeline architecture | `docs/PLAN.md` |
| Scoring factor stack | `docs/FACTOR_STACK.md` |
| Miss taxonomy | `docs/MISS_TAXONOMY.md` |
| Audit adapter / rotor wire | `docs/AUDIT_ADAPTER.md` |
| Cron scheduling | `docs/CRON.md` |
| Tennis program archetypes | `docs/TENNIS_PROGRAM_ARCHETYPES.md` |

## Project layout

```
Kalshi-bot/
├── src/research/         # discover → gate → inspect → score → diversify → report
│   ├── cli.ts            # bun run research
│   ├── cache.ts          # sqlite SSOT (bun:sqlite)
│   ├── patterns.ts       # URLPattern SSOT (github URLs)
│   └── …
├── src/agent/            # CLI: ground, status, patterns, blueprint, report, tennis
├── src/alpha/            # Shadow trading engine (odds feed, signal context, ticker mapper)
├── src/calibration/      # Toxicity loop, outcome resolution, watcher, graduation gates
├── src/institutions/     # kalshi-fees, event-store (tennis bridge, WS recorder, live scores)
├── src/bot/              # Kalshi auth, client, WS, market data, book parse
├── src/db/               # Drizzle ORM schema + client (bun:sqlite)
├── alpha/                # Alpha program tenants (pinnacle-novig-mlb, tennis-tour-pinnacle-novig)
├── research/             # dimensions.json, weights.json, reports, cache, outputs, exports
├── tests/                # bun:test --isolate
└── tools/                # restore-committed-artifacts, rate-limit, miss-taxonomy
```

## Environment

- **Runtime:** Bun >= 1.3.13 (packageManager pin in `package.json`)
- **Deps:** Zero runtime npm deps. `drizzle-orm` + `zod` only.
- **CLI:** `gh auth login` required for research pipeline.
- **Secrets:** Proton Pass CLI optional; `.env.protonpass` for `KALSHI_*` / `ODDS_API_KEY`.

## Essential commands

### Research pipeline

```bash
bun run research                              # full pipeline → latest.md
bun run research -- --dimension=market-making # targeted dimension
bun run research -- --dry-run                 # discover + gate + budget check only
bun run research -- --export-audit            # + audit JSONL + rotor bundle
bun run export-audit -- --latest              # export from latest production run

bun run rate-limit:status                     # check GitHub code_search bucket
bun run agent ground                          # cache-only triage (zero network)
bun run agent status                          # newest production run
bun run agent patterns                        # pattern extract from cached run
bun run agent blueprint                       # architecture blueprint
bun run serve                                 # report browser (:3456, --hot)
bun run report:term                           # ANSI latest.md in terminal
```

### Verification

```bash
bun run check           # typecheck + test + artifact restore
bun test                # full suite (--isolate)
bun test --grep "pattern"
bun run typecheck
bun run hooks:install   # once: pre-commit gate
```

### Alpha / shadow trading

```bash
# 1. Toxicity loop (must run before ticks)
bun run calibration:toxicity:loop

# 2. Live shadow tick (separate terminal)
bun run alpha:run -- --program=pinnacle-novig-mlb --ticker=KXMLBGAME-... --fetch-book

# 3. After games — resolve outcomes
bun run calibration:resolve-outcomes -- --program=pinnacle-novig-mlb --file=research/outcomes.json

# 4. Weekly review
bun run calibration:watcher

# Combined maintenance
bun run calibration:maintenance -- --program=pinnacle-novig-mlb --fetch-toxicity --resolve=research/outcomes.json
```

### Tennis event-store (parallel institution)

```bash
bun run tennis:itf -- --sync --retain-days=3          # refresh markets + bridge
bun run agent tennis                                  # coverage + artifact triage
bun run tennis:record -- --ws --ws-seconds=300        # WS orderbook capture
bun run tennis:ws-ground                              # WebView + Image dashboard
bun run agent tennis --webview                        # ground + dashboard capture
```

## Key conventions

### Bun-native dependency rule
Before adding any package, check `docs/BUN_NATIVE.md`. Prefer Bun builtins: `Bun.fetch`, `Bun.$`, `bun:sqlite`, `Bun.hash`, `Bun.zstdCompressSync`, `Bun.WebView`, `Bun.Image`, `Bun.cron`, `Bun.Glob`, `mock.module()`.

### Fee math (single convention)
```
raw_edge = p_model − kalshi_price
trade iff raw_edge > fees(price) + slippage_margin
```
SSOT: `src/institutions/kalshi-fees.ts`. Never double-count fees.

### Kalshi book semantics
Kalshi GET `/markets/{ticker}/orderbook` returns **bids only** (YES). NO bid at Q ↔ YES ask at (100 − Q). Code: `src/bot/kalshi-book-parse.ts`. Crossed book (`yesBid + noBid > 100`) → skip tick.

### Shadow log (append-only)
Prediction lines are **never rewritten**. Toxicity marks and outcome resolutions are **new chained entries** referencing `refLineHash`. Watcher joins at read time via `materializeShadowLines()`.

### Alpha program scaffolding
```bash
bun create alpha-program alpha/<name> --no-git
# or: bun run alpha:init <name> --dimension=sports-nba
```
Template SSOT: `.bun-create/alpha-program/` only. First act: complete `hypothesis.md`.

### Graduation gates (do not regress)
| Gate | Default |
|------|---------|
| `graduationMinRealizedEdgeCentsPerFill` | 2 |
| `graduationMinFills` | 30 |
| `graduationMinDistinctEvents` | 40 |
| `shadowMinSignals` / `killBrierDriftPct` | 100 / 15% |
| `shadowMinWeeks` | 3 |

Never graduate on Brier alone. Kill artifacts are first-class.

### Invariants
1. **No alpha code in the harness** — detectors score repos; never import `src/alpha/`.
2. **Same gauntlet for every program** — no bypass.
3. **~20% fixed harness slice** — calibration, detectors, evidence.
4. **Graduations and kills both exported** — honest memory compounds.

### Test artifacts
Tests overwrite `latest.md` and audit JSONL. **`posttest` restores from fixtures** automatically. Protected paths: `research/reports/latest.md`, `research/reports/latest.diff.md`, `research/audit-evidence/*.jsonl`.

### Commit flow
```bash
bun run check      # typecheck + test + artifact restore
bun run hooks:install  # once
# pre-commit runs check + deletion guard automatically
```

## When to use this skill

- Running or debugging the research pipeline (discover, gate, inspect, score, report)
- Working with alpha shadow trading: odds feed, signal context, ticker mapping, fee-aware edge
- Operating calibration loop: toxicity marking, outcome resolution, Brier scoring, watcher graduation
- Working with tennis event-store: ITF bridge, WS orderbook recording, live scores, WebView ground
- Adding or modifying Bun-native tooling, CLI scripts, or detectors
- Scaffolding new alpha program tenants
- Analyzing shadow logs, calibration artifacts, or research cache
- Extending the factor stack, scoring model, or audit export pipeline

## Related skills

- `bet-ticker-worker` — Cloudflare Worker live wager broadcast, shade pipeline, steam detection. Similar sports-betting domain, different stack (CF Workers vs Bun-native).
- `cascade-mover` — Real-time sports betting intelligence terminal with SQLite, WebSocket, MCP bridge. Complementary trading infrastructure.
- `seaborn-visualization` — For analyzing calibration data, shadow log distributions, Brier scores.
- `xlsx` — For exporting research scoring tables or calibration summaries.
