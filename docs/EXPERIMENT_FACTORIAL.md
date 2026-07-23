# Factorial experiments — ops design and analysis

Operational **design of experiments (DOE)** for partner-facing knobs (routing, cut, stake method, timing). Distinct from [`FACTOR_STACK.md`](FACTOR_STACK.md), which scores GitHub repos.

## Terminology

| Term | Research (FACTOR_STACK) | Ops (this doc) |
|------|-------------------------|----------------|
| factor | Evidence scope layer | DOE variable with discrete levels |
| variant | — | One level-combination cell |
| partner | — | Subject assigned to a variant |

## Code map

| Module | Role |
|--------|------|
| [`src/operations/factorial.ts`](../src/operations/factorial.ts) | Design generation, balanced assignment, main/interaction analysis |
| [`src/operations/experiment-schema.ts`](../src/operations/experiment-schema.ts) | SQLite schema + `openExperimentsDb()` |
| [`src/operations/experiment-runner.ts`](../src/operations/experiment-runner.ts) | Launch, assign, record, daily check, early stop |
| [`src/operations/experiment-store.ts`](../src/operations/experiment-store.ts) | `research/cache/tennis-experiments/latest.json` artifacts |
| [`src/operations/experiment-shadow-bridge.ts`](../src/operations/experiment-shadow-bridge.ts) | Shadow log → `experiment_metrics` ETL |
| [`tools/tennis/experiment-cli.ts`](../tools/tennis/experiment-cli.ts) | Operator CLI |
| [`tools/tennis/experiment-scheduled.ts`](../tools/tennis/experiment-scheduled.ts) | Daily `dailyCheckAll` worker (Bun.cron) |
| [`tools/tennis/experiment-schedule-cli.ts`](../tools/tennis/experiment-schedule-cli.ts) | OS cron register/remove/preview |

DB path: `research/cache/ops-experiments.db` (gitignored with `research/cache/`).

## Variant IDs

Reversible `factor=level&…` strings (sorted keys), e.g. `cut=0.1&routing=dynamic`. Not positional `_` splits.

## Phased rollout (recommended)

| Phase | Factors | Variants | Min weeks |
|-------|---------|----------|-----------|
| 1 | routing | 2 | 4 |
| 2 | + cut | 4 | 6 |
| 3 | + stake method | 8 | 8 |
| 4 | + timing | 16 | 12 |

Use **≤4 factors** per experiment. For binary (2-level) factors with `--fraction=2`, the engine uses a **Resolution-IV half-replicate** (generator: last factor = product of others). Non-binary or other fractions fall back to naive subsampling.

## System factors (do not randomize per partner)

- Model type → champion/challenger via alpha shadow logs + [`calibration/watcher.ts`](../src/calibration/watcher.ts)
- Automation frequency, reconciliation, Kalshi WS/REST infra
- Platform (Kalshi-only today)

## Operator commands

```bash
# Phase 1 — routing only
bun run tennis:experiment -- launch --name=phase1 --routing=static,dynamic --json

# Phase 2 — routing + cut
bun run tennis:experiment -- launch --name=phase2 --routing=static,dynamic --cut=0.1,0.15 --json

bun run tennis:experiment -- assign --experiment=<id> --partner=<eventId>
bun run tennis:experiment -- record --experiment=<id> --partner=<eventId> --outcome=1 [--metric-id=<id>]
bun run tennis:experiment -- status --experiment=<id>
bun run tennis:experiment -- check --experiment=<id>
bun run tennis:experiment -- check-all
bun run tennis:experiment -- latest

# OS cron (daily 09:00 local) — see [CRON.md](CRON.md)
bun run tennis:experiment:register
bun run tennis:experiment:preview
bun run tennis:experiment:remove
```

## Metrics bridge (shadow log ingest)

Resolved shadow trades ETL into `experiment_metrics` via the CLI. Partner IDs from the log must match `assign` (`--partner=<eventId>` when using default `--partner-key=eventId`).

```bash
bun run tennis:experiment -- ingest --experiment=<id> --program=tennis-game-model
bun run tennis:experiment -- ingest --experiment=<id> --program=tennis-game-model --partner-key=eventId --dry-run
```

Module: [`src/operations/experiment-shadow-bridge.ts`](../src/operations/experiment-shadow-bridge.ts). Manual outcomes still work via `record`. Ingest is idempotent on shadow `lineHash`.

## Scheduled daily check

Worker [`tools/tennis/experiment-scheduled.ts`](../tools/tennis/experiment-scheduled.ts) calls `dailyCheckAll()` — runs `dailyCheck` per active experiment and persists artifacts when status changes.

```bash
bun run tennis:experiment -- check-all   # manual
bun run tennis:experiment:register       # OS cron
```

Override: `TENNIS_EXPERIMENT_CRON_SCHEDULE`, `TENNIS_EXPERIMENT_CRON_TITLE` (SSOT: [`tennis-lane-constants.ts`](../src/institutions/event-store/tennis-lane-constants.ts)).

## Statistical caveats

- Between-subjects assignment only — no switchback/washout yet
- No cluster randomization — watch spillover on cut/routing comparisons
- Analysis is unweighted cell means — export CSV for mixed models when partner heterogeneity matters

## Agent triage

`bun run agent tennis` surfaces the latest experiment artifact and suggests launch/check/assign/ingest/cron. See [`AGENT.md`](AGENT.md) (tennis section).
