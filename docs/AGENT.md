# Agent tools

CLI helpers over `cache.db` and committed reports. No HTTP dashboard, no rotor pulse bridge.

## Commands

```bash
bun run agent status                    # latest run from cache.db
bun run agent run-research              # spawn research locally (+ audit export)
bun run agent patterns                  # static pattern report from evidence paths
bun run agent blueprint                 # Bun stack architecture blueprint
bun run agent report                    # cross-dimension architecture summary
bun run report:term                     # ANSI-render latest.md in the terminal
bun run report:diff                     # ANSI-render latest.diff.md
```

JSON on parsed subcommands: append `--json` (no extra `--`).

```bash
bun run agent status --json
bun run agent patterns --json --dimension=market-making
bun run agent blueprint --json --no-write
```

## `status`

Reads the latest production run from `research/cache/cache.db` (optional `--dimension`). Reports discovered → gated → shortlist and stale/freshness flags. No pulse or audit-catalog reads.

## `run-research`

Always runs locally via IPC spawn (TTY) or in-process (`--in-process` / `--json`). Equivalent to `bun run research` with `--export-audit`.

```bash
bun run agent run-research -- --dimension=price-data
bun run agent run-research -- --json --in-process
```

## `patterns`

Extracts auth/order/Bun-feature patterns from detector evidence paths for a cached run.

```bash
bun run agent patterns --dimension=market-making
bun run agent patterns --repo=owner/name --open   # needs REPO_CLONE_ROOT
```

Writes `research/patterns/patterns-latest-{dimension}.md` unless `--no-write`.

## `blueprint`

Builds `research/reports/architecture-blueprint.md` from cached runs + pattern reports + lift map (score/tier only — no rotor verification badges).

## `report`

Cross-dimension summary → `research/reports/agent-report.md`.

## Audit export (write-only)

Rotor ingest remains optional and one-way:

```bash
bun run research -- --export-audit
bun run export-audit -- --latest
```

This project does not read `pulse.log` or `audit-catalog.json`.
