# Kalshi GitHub Bot Research Agent

Standalone Bun project for discovering and ranking public [Kalshi](https://kalshi.com) trading bots on GitHub.

**Zero runtime npm dependencies** — Bun + authenticated [`gh`](https://cli.github.com/) CLI only.

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.4 ([`URLPattern`](https://bun.com/blog/bun-v1.3.4#urlpattern-api) for GitHub URLs)
- GitHub CLI on PATH (`gh auth login`)

## Quick start

```bash
cd /path/to/Kalshi-bot

bun run research                         # full pipeline → latest.md
bun run serve                            # report browser (:3456, --hot)
bun test && bun run typecheck
```

### CLI flags

```bash
bun run research -- --json               # full run JSON on stdout
bun run research -- --shortlist 12       # override shortlist size
bun run research -- --diff <run-id>      # diff vs a specific prior run
bun run research -- --export-audit       # also write audit JSONL + rotor bundle
bun run export-audit -- --latest         # export from latest production run in cache.db
bun run export-audit -- --run <run-id>   # export from explicit run
bun run export-audit -- --verify research/exports/audit/<run-id>
```

Gate overrides: `--min-stars`, `--min-forks`, `--max-age-months` or env vars below.

### Env overrides

| Variable | Purpose |
|----------|---------|
| `RESEARCH_MIN_STARS` | Popularity gate (stars) |
| `RESEARCH_MIN_FORKS` | Popularity gate (forks) |
| `RESEARCH_MAX_AGE_MONTHS` | Max repo age |
| `RESEARCH_SHORTLIST` | Shortlist size (default 12) |
| `PORT` | Serve port (default 3456) |

## Scripts

| Script | Command |
|--------|---------|
| Research | `bun run research` |
| Audit export | `bun run export-audit` |
| Serve (hot) | `bun run serve` |
| Serve (once) | `bun run serve:once` |
| Tests | `bun test` / `bun run test:coverage` |
| Types | `bun run typecheck` |

## What gets committed

| Path | In git? | Notes |
|------|---------|-------|
| `research/reports/latest.md` | yes | Human shortlist + evidence |
| `research/reports/latest.diff.md` | yes | Diff vs previous production run |
| `research/audit-evidence/*.jsonl` | yes | Line evidence (one file per promoted repo) |
| `research/queries.json`, `weights.json`, `keywords.json` | yes | Config SSOT |
| `research/schemas/repo-report.schema.json` | yes | RepoReport wire schema |
| `research/cache/cache.db` | no | API cache + run history |
| `research/outputs/` | no | Full JSON run dumps |
| `research/exports/audit/` | no | Per-run finding wire + `rotor-ingest.json` |
| `research/reports/run_*.md` | no | Per-run MD (history in sqlite) |

Evidence path SSOT: `src/research/paths.ts` (`auditEvidenceRelPath`, `AUDIT_EVIDENCE_DIR`).

## Project layout

```
Kalshi-bot/
├── src/research/
│   ├── cli.ts              # bun run research
│   ├── export-audit-cli.ts # bun run export-audit
│   ├── discover.ts … diversify.ts, score.ts, inspect.ts
│   ├── evidence.ts, validate.ts, audit-adapter.ts, export-audit.ts
│   ├── patterns.ts         # URLPattern SSOT (discover, reports, serve)
│   ├── serve.ts, views.ts  # Bun.serve report browser
│   ├── cache.ts, diff.ts, report.ts, paths.ts, constants.ts
│   └── gh.ts, pool.ts, preflight.ts, detect.ts, types.ts
├── tests/                  # bun:test (61 tests)
├── research/
│   ├── audit-evidence/     # committed JSONL
│   ├── reports/            # latest.md + latest.diff.md
│   ├── schemas/
│   ├── queries.json, weights.json, keywords.json
│   ├── cache/              # gitignored
│   ├── outputs/            # gitignored
│   └── exports/            # gitignored
└── docs/                   # PLAN, FACTOR_STACK, AUDIT_ADAPTER, BUN_*
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

Production runs use ISO timestamp ids (`2026-07-22T04-59-00-818Z`). Test fixture runs in `cache.db` are ignored when resolving “latest” for CLI and serve.

## Audit export (optional)

High-value shortlist repos (≥70 pts, auth + order matched) can export to monorepo-compatible `AuditFinding` wire + sha3-256 JSONL:

```bash
bun run research -- --export-audit
# or
bun run export-audit -- --run 2026-07-22T04-59-00-818Z
```

See [`docs/AUDIT_ADAPTER.md`](docs/AUDIT_ADAPTER.md).

## Docs

- [`docs/PLAN.md`](docs/PLAN.md) — as-built design
- [`docs/FACTOR_STACK.md`](docs/FACTOR_STACK.md) — scoring SSOT
- [`docs/AUDIT_ADAPTER.md`](docs/AUDIT_ADAPTER.md) — audit wire + rotor ingest
- [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md) — API map
- [`docs/BUN_SHELL.md`](docs/BUN_SHELL.md) — `Bun.$` patterns

## Dependency rule

Before adding a package, check [`docs/BUN_NATIVE.md`](docs/BUN_NATIVE.md).
