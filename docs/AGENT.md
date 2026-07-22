# Agent tools

CLI helpers over `cache.db` and committed reports. No HTTP dashboard, no rotor pulse bridge.

## Commands

```bash
bun run agent status                    # newest production run (any dimension)
bun run agent run-research              # spawn research locally (audit export on by default)
bun run agent patterns                  # static pattern report from evidence paths
bun run agent blueprint                 # Bun stack architecture blueprint
bun run agent report                    # cross-dimension architecture summary
bun run report:term                     # ANSI-render latest.md in the terminal
bun run report:diff                     # ANSI-render latest.diff.md
```

Put flags on the subcommand (no inner `--`):

```bash
bun run agent status --json
bun run agent status --dimension=market-making
bun run agent patterns --json --dimension=market-making
bun run agent run-research --dimension=price-data --no-export-audit
bun run agent blueprint --json --no-write
```

A leading `--` before flags is tolerated for muscle memory (`agent status -- --dimension=x`) but prefer the forms above.

## `status`

Reads the newest eligible production run from `research/cache/cache.db`.

- No `--dimension` → latest run **across all dimensions**
- `--dimension=<id>` → that slice only (null / “none” when missing — no cross-dimension fallback)

Reports discovered → gated → shortlist and stale/freshness flags. No pulse or audit-catalog reads.

## `run-research`

Always runs locally via IPC spawn (TTY) or in-process (`--in-process` / `--json`). Defaults to `--export-audit`; pass `--no-export-audit` to skip the rotor wire.

```bash
bun run agent run-research --dimension=price-data
bun run agent run-research --json --in-process --no-export-audit
```

## `patterns`

Extracts auth/order/Bun-feature patterns from detector evidence paths for a cached run.

```bash
bun run agent patterns --dimension=market-making
bun run agent patterns --repo=owner/name --open   # needs REPO_CLONE_ROOT
```

Writes `research/patterns/patterns-latest-{dimension}.md` unless `--no-write`.

## `blueprint`

Builds `research/reports/architecture-blueprint.md` from cached runs + pattern reports + lift map (score/tier only). Pattern attach is **cache-only** (no live GitHub fetches).

## `report`

Cross-dimension summary → `research/reports/agent-report.md`.

## Audit export (write-only)

Rotor ingest remains optional and one-way:

```bash
bun run research -- --export-audit
bun run export-audit -- --latest
```

This project does not read `pulse.log` or `audit-catalog.json`.
