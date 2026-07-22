# Kalshi GitHub Bot Research Agent

Standalone Bun project for discovering and ranking public [Kalshi](https://kalshi.com) trading bots on GitHub.

**Zero runtime npm dependencies** — Bun + authenticated [`gh`](https://cli.github.com/) CLI only.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.13 ([`URLPattern`](https://bun.com/blog/bun-v1.3.4#urlpattern-api), [`Bun.cron`](https://bun.com/docs/runtime/cron), [SHA3-256](https://bun.com/blog/bun-v1.3.13#sha3-support-in-webcrypto-and-node-crypto))
- GitHub CLI on PATH (`gh auth login`)

## Quick start

```bash
cd /path/to/Kalshi-bot

bun run research                         # full pipeline → latest.md
bun run serve                            # report browser (:3456, --hot)
bun run agent ground                     # discovery-grounded triage (cache-only)
bun run agent status                     # latest run from cache.db
bun run agent patterns                   # pattern extract from cached run
bun run agent blueprint                  # architecture blueprint from cache
bun run report:term                      # ANSI latest.md in terminal
bun test && bun run typecheck            # posttest restores committed artifacts from fixtures
```

### Commit flow

Tests can overwrite `latest.md` or audit JSONL — **`posttest` restores from fixtures** automatically. Before committing:

```bash
bun run check                            # typecheck + test + artifact restore
bun run hooks:install                    # once: install pre-commit gate
git add … && git commit                  # pre-commit runs check + deletion guard
```

Protected paths: `research/reports/latest.md`, `research/reports/latest.diff.md`, `research/audit-evidence/*.jsonl`.

### GitHub rate limits (preflight before live runs)

Inspect uses `gh search code` — **`code_search` bucket (10/min)**, not `core`. Preflight blocks the run when quota is insufficient:

```bash
bun run rate-limit:status                              # read all buckets
bun run rate-limit:status -- --gated=49 --uncached=49  # price-data inspect estimate
bun run research -- --dimension=price-data             # fails fast if code_search too low
```

Optional: `GITHUB_RATE_LIMIT_WAIT=1` opts into `Bun.sleep` until reset (per-bucket cap; code_search ≤2 min/pause).
Tests skip preflight: `RESEARCH_SKIP_RATE_PREFLIGHT=1`.

### CLI flags

```bash
bun run research -- --dimension=market-making   # targeted dimension → latest-market-making.md
bun run research -- --dimension=sports-nba --dry-run   # discover+gate+budget only (no inspect)
bun run research -- --dimension=sports-nba --export-audit
bun run research -- --json               # full run JSON on stdout
bun run research -- --shortlist 12       # override shortlist size
bun run research -- --diff <run-id>      # diff vs a specific prior run
bun run research -- --export-audit       # also write audit JSONL + rotor bundle
bun run export-audit -- --latest         # export from latest production run in cache.db
bun run audit:export -- --latest         # alias for export-audit
bun run export-audit -- --run <run-id>   # export from explicit run
bun run export-audit -- --verify research/exports/audit/<run-id>
```

`--dry-run` runs discover + popularity gate + `code_search` budget check, then prints `allowed: yes|no` and exits (`0` allowed, `2` blocked). It never inspects or writes reports. Over-budget inspect is allowed only with `GITHUB_RATE_LIMIT_WAIT=1` (multi-wave crawl).

Gate overrides: `--min-stars`, `--min-forks`, `--max-age-months` or env vars below.

Niche dimensions (`sports-nba`, `tracking`, …) may discover candidates but produce an **empty shortlist** if none pass the popularity gate. Check `Discovered` in the report stats — if it is low, broaden queries in [`research/dimensions.json`](research/dimensions.json) (tight sport-specific terms first, then a broader fallback query per dimension).

### Env overrides

| Variable | Purpose |
|----------|---------|
| `RESEARCH_MIN_STARS` | Popularity gate (stars) |
| `RESEARCH_MIN_FORKS` | Popularity gate (forks) |
| `RESEARCH_MAX_AGE_MONTHS` | Max repo age |
| `RESEARCH_SHORTLIST` | Shortlist size (default 12) |
| `RESEARCH_DIMENSION` | Research slice from `research/dimensions.json` (default `all`) |
| `RESEARCH_EXPORT_AUDIT` | Set `1` on scheduled runs to export audit |
| `RESEARCH_CRON_SCHEDULE` | Override cron expression (see CRON.md) |
| `RESEARCH_CRON_TITLE` | OS cron job title |
| `PORT` | Serve port (default 3456) |
| `REPO_CLONE_ROOT` | Local clones for `agent patterns --open` |

## Scripts

| Script | Command |
|--------|---------|
| Research | `bun run research` |
| Audit export | `bun run export-audit` or `bun run audit:export` |
| Schedule (OS cron) | `bun run schedule:register` / `schedule:remove` / `schedule:preview` |
| Agent tools | `bun run agent <cmd>` — see [`docs/AGENT.md`](docs/AGENT.md) |
| Terminal report | `bun run report:term` / `report:diff` |
| Serve (hot) | `bun run serve` |
| Serve (once) | `bun run serve:once` |
| Tests | `bun test` / `bun run test:coverage` (`posttest` restores committed artifacts) |
| Restore artifacts | `bun run artifacts:restore` — fixtures → reports + audit JSONL |
| Pre-commit gate | `bun run hooks:install` then `git commit` runs `bun run check` |
| Types | `bun run typecheck` |
| Full check | `bun run check` — typecheck + test |

## Cache, diff, and artifacts

| Concern | Implementation |
|---------|----------------|
| **Bounded concurrency** | `pool.ts` `mapPool()` — inspect capped at `DEFAULT_INSPECT_CONCURRENCY` (4) |
| **Disk cache** | `cache.ts` → `research/cache/cache.db` — `Bun.hash(repo:endpoint:pushed_at)` |
| **Run-to-run diff** | `diff.ts` — baseline = latest production run in sqlite (or `--diff <run-id>`) |
| **JSON dumps** | `research/outputs/` — gitignored (`run_*.json`, `latest.json`) |
| **Markdown reports** | `research/reports/latest.md` + `latest.diff.md` — **committed** |
| **Report fixtures** | `latest.md.fixture` — SSOT for `posttest` restore after tests overwrite reports |

After each `bun run research`, sqlite stores the full run payload; markdown snapshots the human-facing shortlist and diff excerpt.

## What gets committed

| Path | In git? | Notes |
|------|---------|-------|
| `research/reports/latest.md` | yes | Human shortlist + evidence |
| `research/reports/latest.md.fixture` | yes | Test restore SSOT for `latest.md` |
| `research/reports/latest.diff.md` | yes | Diff vs previous production run |
| `research/reports/latest.diff.md.fixture` | yes | Test restore SSOT for diff |
| `research/audit-evidence/*.jsonl` | yes | Line evidence (one file per promoted repo) |
| `research/dimensions.json` | yes | Dimension query sets (market-making, sports-nba/nfl/…, tracking, …) |
| `research/queries.json` | yes | Deprecated reference — use `dimensions.json` (`all`) |
| `research/weights.json`, `keywords.json` | yes | Scoring + detector keywords SSOT |
| `src/research/constants.ts` | yes | Typed SSOT — detector ids, weights, licenses, thresholds |
| `research/schemas/repo-report.schema.json` | yes | RepoReport wire schema |
| `research/cache/cache.db` | no | API cache + run history |
| `research/outputs/` | no | Full JSON run dumps |
| `research/exports/audit/` | no | Per-run finding wire + `rotor-ingest.json` |
| `research/reports/run_*.md` | no | Per-run MD (history in sqlite) |

Evidence path SSOT: [`src/research/paths.ts`](src/research/paths.ts). Pipeline parameters (detector ids, component weights, license markers, audit thresholds): [`src/research/constants.ts`](src/research/constants.ts) — keep aligned with `research/weights.json`.

## Project layout

```
Kalshi-bot/
├── src/
│   ├── research/           # discover → gate → inspect → score → diversify → report
│   │   ├── cli.ts          # bun run research
│   │   ├── export-audit-cli.ts, scheduled.ts, schedule-cli.ts
│   │   ├── patterns.ts     # URLPattern SSOT (github-url.ts removed — use patterns.ts)
│   │   ├── constants.ts    # weights, licenses, audit thresholds, cron
│   │   └── … cache, diff, evidence, audit-adapter, serve, views
│   └── agent/              # CLI: status, patterns, blueprint, report, report:term
├── tools/
│   └── restore-latest-report.ts   # posttest: fixture → latest.md
├── tests/                  # bun:test (posttest restores reports)
├── research/
│   ├── audit-evidence/     # committed JSONL (high-value + watchlist exports)
│   ├── reports/            # latest.md + fixtures
│   ├── dimensions.json, weights.json, keywords.json
│   ├── cache/              # gitignored sqlite
│   ├── outputs/            # gitignored JSON dumps
│   └── exports/audit/      # gitignored per-run wire + rotor-ingest.json
└── docs/                   # AGENT, AUDIT_ADAPTER, CRON, FACTOR_STACK, …
```

## Scoring model

1. **Popularity gate** — ≥5 stars OR ≥3 forks, pushed within 18 months, not archived
2. **Quality rank** — auth/API (25), order realism (25), tests/CI (15), docs (15), maintenance (10), risk (10)
3. **License** — unlicensed −15; MIT/Apache preferred; called out in `latest.md`
4. **Shortlist** — diversity: min 1 per major strategy tag, max 4 per tag, TS/JS tiebreak

Details: [`docs/FACTOR_STACK.md`](docs/FACTOR_STACK.md). Default thresholds and detector ids: [`src/research/constants.ts`](src/research/constants.ts) (aligned with `research/weights.json`).

## Local report browser

```bash
bun run serve
```

| Route | What |
|-------|------|
| `/` | Stats, shortlist, scored table, diff excerpt, run history |
| `/api/runs` | Run summaries JSON |
| `/api/runs/:id` | Full run JSON |
| `/repo/:owner/:name` | Repo detail + score breakdown (`?run=<id>`) |
| `/reports/latest.md` | Committed markdown report |

Production runs use ISO timestamp ids (e.g. `2026-07-22T05-50-48-875Z`). `loadLatestRunFromDb` skips test fixture ids (named runs, year 2099, future `generatedAt`) — see `isProductionRunId` / `isEligibleProductionRun` in `cache.ts`.

## Audit export (optional)

High-value and **watchlist** shortlist repos export to monorepo-compatible `AuditFinding` wire + sha3-256 JSONL:

| Tier | Gate |
|------|------|
| high-value | ≥70 total, auth + order matched, ≥15 pts each |
| watchlist | ≥65 total, auth + order matched, ≥12 pts each |

```bash
bun run research -- --export-audit
bun run export-audit -- --latest
bun run export-audit -- --run 2026-07-22T05-50-48-875Z --repo openfi-dao/kalshi-trading-bot
```

See [`docs/AUDIT_ADAPTER.md`](docs/AUDIT_ADAPTER.md) for the optional write-only rotor ingest wire.

## Alpha programs

**July 2026:** NBA is off-season — live baseline is [`alpha/pinnacle-novig-mlb/`](alpha/pinnacle-novig-mlb/) on Kalshi `KXMLBGAME` + Odds API `baseball_mlb`. NBA baseline [`alpha/pinnacle-novig-nba/`](alpha/pinnacle-novig-nba/) resumes when `KXNBAGAME` markets open (~October).

Baseline measuring stick: `role: baseline`. Template: [`.bun-create/alpha-program/`](.bun-create/alpha-program/). Engine: [`src/alpha/`](src/alpha/). Institutions: [`src/institutions/`](src/institutions/). Full doctrine: [`.cursor/skills/plan/SKILL.md`](.cursor/skills/plan/SKILL.md).

Scaffold a tenant (always `--no-git`):

```bash
bun create alpha-program alpha/<name> --no-git
# or: bun run alpha:init <name> --dimension=sports-nba
```

### Shadow operator loop (live baseline)

**Gate:** set `ODDS_API_KEY` before any baseline shadow data. `--offline` uses fixture odds — valid for plumbing checks only, not calibration. Discard offline lines before counting toward graduation.

**Order:** toxicity loop running → live ticks → volume → outcomes last (manual, ~30s).

| Step | When | Command |
|------|------|---------|
| **1. Toxicity loop** | Start **before** ticks; keep running | `bun run calibration:toxicity:loop` |
| **2. Live shadow tick** | Each signal (live book + live Pinnacle) | `bun run alpha:run -- --program=pinnacle-novig-mlb --ticker=KXMLBGAME-... --fetch-book` |
| **3. Resolve outcomes** | After game settles | `bun run calibration:resolve-outcomes -- --program=pinnacle-novig-mlb --file=research/outcomes.json` |
| **4. Watcher** | Weekly / batch review | `bun run calibration:watcher` |

Terminal 1 (leave open):

```bash
export ODDS_API_KEY=…
bun run calibration:toxicity:loop
```

Terminal 2 (repeat per ticker):

```bash
bun run alpha:run -- \
  --program=pinnacle-novig-mlb \
  --ticker=KXMLBGAME-26JUL242010ATHMIN-MIN \
  --fetch-book
```

Map new tickers in [`research/ticker-overrides.json`](research/ticker-overrides.json). Shadow logs live under `alpha/*/shadow-log.jsonl` (gitignored). Background daemon alternative: `bun run calibration:toxicity:register`.

Combined maintenance (outcomes + optional mid fetch): `bun run calibration:maintenance -- --program=pinnacle-novig-mlb --fetch-toxicity --resolve=research/outcomes.json`

**Graduation breadth gate:** `graduationMinDistinctEvents` (default 40) — resolved lines must span ≥40 distinct games; one-game tick-spam cannot graduate.

## Docs

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phases, blockers, proof checklist (**start here**)
- [`docs/OFFICIAL_URLS.md`](docs/OFFICIAL_URLS.md) — verified Kalshi / Odds API / Bun links
- Alpha shadow loop — **this README § Alpha programs** · calibration: `src/calibration/watcher.ts`
- [`docs/AGENT.md`](docs/AGENT.md) — CLI sub-agents: ground, status, patterns, blueprint, report
- [`docs/MISS_TAXONOMY.md`](docs/MISS_TAXONOMY.md) — gate/discovery/rate-limit miss map + grounded triage
- [`docs/CRON.md`](docs/CRON.md) — OS-level Bun.cron scheduling
- [`docs/AUDIT_ADAPTER.md`](docs/AUDIT_ADAPTER.md) — audit wire + rotor ingest
- [`docs/FACTOR_STACK.md`](docs/FACTOR_STACK.md) — scoring SSOT
- [`docs/PLAN.md`](docs/PLAN.md) — as-built design
- [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md) — API map
- [`docs/BUN_SHELL.md`](docs/BUN_SHELL.md) — `Bun.$` patterns

## Dependency rule

Before adding a package, check [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md).
