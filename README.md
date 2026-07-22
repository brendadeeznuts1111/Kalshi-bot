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
bun run dashboard                        # agent dashboard (:3457)
bun run agent status                     # CLI status + rotor verification summary
bun run agent suggest-lift               # component lift map (✓/⚠/✗ badges)
bun run serve                            # report browser (:3456, --hot)
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
| `DASHBOARD_PORT` | Dashboard port (default 3457) |
| `ROTOR_ROOT` | Monorepo root for `pulse.log` + audit catalog (default `~/Projects`) |
| `AUDIT_CATALOG_PATH` | Override path to rotor `tools/audit-catalog.json` |
| `DASHBOARD_URL` | Agent CLI dashboard target |

## Scripts

| Script | Command |
|--------|---------|
| Research | `bun run research` |
| Audit export | `bun run export-audit` or `bun run audit:export` |
| Schedule (OS cron) | `bun run schedule:register` / `schedule:remove` / `schedule:preview` |
| Agent dashboard | `bun run dashboard` — see [`docs/DASHBOARD.md`](docs/DASHBOARD.md) |
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
│   └── agent/              # dashboard, CLI, audit-list, suggest-lift, verify-dashboard
├── tools/
│   └── restore-latest-report.ts   # posttest: fixture → latest.md
├── tests/                  # bun:test (126 tests; posttest restores reports)
├── research/
│   ├── audit-evidence/     # committed JSONL (high-value + watchlist exports)
│   ├── reports/            # latest.md + fixtures
│   ├── dimensions.json, weights.json, keywords.json
│   ├── cache/              # gitignored sqlite
│   ├── outputs/            # gitignored JSON dumps
│   └── exports/audit/      # gitignored per-run wire + rotor-ingest.json
└── docs/                   # AGENT, DASHBOARD, AUDIT_ADAPTER, CRON, FACTOR_STACK, …
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

After ingest in `~/Projects`, `bun run agent audit-list` shows pulse verification status.

See [`docs/AUDIT_ADAPTER.md`](docs/AUDIT_ADAPTER.md).

## Docs

- [`docs/AGENT.md`](docs/AGENT.md) — CLI: status, audit-list, suggest-lift, capture-evidence
- [`docs/DASHBOARD.md`](docs/DASHBOARD.md) — Bun.serve dashboard + API routes
- [`docs/CRON.md`](docs/CRON.md) — OS-level Bun.cron scheduling
- [`docs/AUDIT_ADAPTER.md`](docs/AUDIT_ADAPTER.md) — audit wire + rotor ingest
- [`docs/FACTOR_STACK.md`](docs/FACTOR_STACK.md) — scoring SSOT
- [`docs/PLAN.md`](docs/PLAN.md) — as-built design
- [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md) — API map
- [`docs/BUN_SHELL.md`](docs/BUN_SHELL.md) — `Bun.$` patterns

## Dependency rule

Before adding a package, check [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md).
