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
| [`tools/tennis/experiment-cli.ts`](../tools/tennis/experiment-cli.ts) | Operator CLI |

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

Use **≤4 factors** per experiment. Fractional designs in code are naive subsamples — prefer full factorial at these sizes.

## System factors (do not randomize per partner)

- Model type → champion/challenger via alpha shadow logs + [`calibration/watcher.ts`](../src/calibration/watcher.ts)
- Automation frequency, reconciliation, Kalshi WS/REST infra
- Platform (Kalshi-only today)

## Operator commands

```bash
# Phase 1 — routing only
bun run tennis:experiment -- launch --name=phase1 --routing=static,dynamic --json

bun run tennis:experiment -- assign --experiment=<id> --partner=p1
bun run tennis:experiment -- record --experiment=<id> --partner=p1 --outcome=1
bun run tennis:experiment -- status --experiment=<id>
bun run tennis:experiment -- check --experiment=<id>
bun run tennis:experiment -- latest
```

## Metrics bridge (future)

Shadow log outcomes (`src/institutions/shadow-line.ts`) are not yet ETL'd into `experiment_metrics`. Until then, use `record` or a dedicated ingest job after assignment.

## Statistical caveats

- Between-subjects assignment only — no switchback/washout yet
- No cluster randomization — watch spillover on cut/routing comparisons
- Analysis is unweighted cell means — export CSV for mixed models when partner heterogeneity matters
