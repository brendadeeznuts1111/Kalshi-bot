# Kalshi GitHub Bot Research Agent

Standalone Bun project for discovering and ranking public [Kalshi](https://kalshi.com) trading bots on GitHub.

**Zero runtime npm dependencies** — Bun + authenticated [`gh`](https://cli.github.com/) CLI only.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.4 (uses [`URLPattern`](https://bun.com/blog/bun-v1.3.4#urlpattern-api) for GitHub URL parsing)
- GitHub CLI on PATH (`gh auth login`)

## Quick start

```bash
cd /path/to/Kalshi-bot

bun run research                  # discover → gate → inspect → score → report
bun run serve                     # local report browser (Bun.serve, --hot)
bun run research -- --json        # full run JSON on stdout
bun run research -- --export-audit   # emit audit findings from same run
bun run export-audit -- --latest     # re-export from cache.db latest run
bun run export-audit -- --verify research/exports/audit/<run-id>
bun run research -- --diff <run-id>   # compare vs prior run (from cache.db)
bun test
bun run typecheck
```

### Env overrides

| Variable | Purpose |
|----------|---------|
| `RESEARCH_MIN_STARS` | Popularity gate (stars) |
| `RESEARCH_MIN_FORKS` | Popularity gate (forks) |
| `RESEARCH_MAX_AGE_MONTHS` | Max repo age |
| `RESEARCH_SHORTLIST` | Shortlist size (default 12) |

## Project layout

```
Kalshi-bot/
├── src/research/       # pipeline (discover, gate, inspect, score, report)
│   ├── export-audit.ts     # audit export + rotor-ingest.json + verify
│   ├── audit-adapter.ts    # RepoReport → AuditFinding wire
│   ├── validate.ts         # RepoReport structural validation
│   ├── patterns.ts     # BunURLPattern SSOT (discover + reports + serve)
│   ├── views.ts        # HTML templates (serve browser)
│   └── serve.ts        # Bun.serve report browser
├── tests/              # bun:test (incl. mock.module for gh.ts)
├── research/
│   ├── queries.json    # GitHub search queries
│   ├── weights.json    # scoring + gate thresholds
│   ├── keywords.json   # strategy tags + code-search terms
│   ├── reports/        # latest.md + latest.diff.md (committed)
│   ├── audit-evidence/ # committed JSONL evidence (one file per repo)
│   ├── schemas/        # repo-report.schema.json
│   ├── exports/        # per-run audit bundles (gitignored)
│   ├── outputs/        # JSON runs (gitignored)
│   └── cache/          # cache.db sqlite (gitignored)
└── docs/               # PLAN, FACTOR_STACK, AUDIT_ADAPTER, BUN_NATIVE
```

## Scoring model

- **Popularity** is a gate only (≥5 stars OR ≥3 forks, pushed within 18 months, not archived)
- **Rank on** auth/API correctness, order realism, tests, docs, maintenance, risk controls
- **License** matters: unlicensed repos penalized; MIT/Apache preferred
- **Shortlist** enforces strategy diversity (min 1 per major tag, max 4 per tag)

## Bun-native stack

| Module | Role |
|--------|------|
| `gh.ts` | All GitHub access via `Bun.$` |
| `patterns.ts` | `URLPattern` SSOT — discover, report links, serve routes |
| `serve.ts` | `Bun.serve` local report browser (`cache.db` reads) |
| `cache.ts` | `bun:sqlite` + `Bun.hash` (API cache + run history) |
| `pool.ts` | Bounded concurrency (no p-limit) |
| `preflight.ts` | `Bun.which("gh")` |

Run history and `--diff` use **`research/cache/cache.db`**, not committed JSON blobs.

## Local report browser

```bash
bun run serve    # Bun.serve with --hot, default port 3456 (PORT env)
```

| Route | What |
|-------|------|
| `/` | Stats, shortlist, scored table, diff excerpt, run history |
| `/api/runs` | Run summaries JSON |
| `/api/runs/:id` | Full run JSON |
| `/repo/:owner/:name` | Repo detail + score breakdown (`?run=<id>`) |
| `/reports/latest.md` | Committed markdown report |

Report links and server routes share [`patterns.ts`](src/research/patterns.ts) — no drift between markdown `local` links and live routes.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — full design
- [`docs/FACTOR_STACK.md`](docs/FACTOR_STACK.md) — scoring SSOT (scopes, types, debug lens)
- [`docs/AUDIT_ADAPTER.md`](docs/AUDIT_ADAPTER.md) — RepoReport → AuditFinding export + rotor ingest
- [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md) — API map + `@see` links
- [`docs/BUN_SHELL.md`](docs/BUN_SHELL.md) — `Bun.$` reference

## Dependency rule

Before adding a package, check [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md).
