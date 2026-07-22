# Agent tools

CLI helpers over `cache.db` and committed reports. No HTTP dashboard, no rotor pulse bridge.

## Sub-agent mesh

Each command is a focused **sub-agent** grounded in local evidence (`cache.db`, patterns, dimensions.json). Nothing invents live GitHub state unless you explicitly run research.

| Sub-agent | Command | Grounding |
|-----------|---------|-----------|
| **ground** | `agent ground` | Orchestrates status + cache readiness + miss taxonomy + next actions (cache-only). Coverage: exact → qualifier-normalized → bare phrase. `saveRun` stamps discoverGate (miss queries → else resolveDiscoverGate); unstamped rows also inferred at read time. `pushed:` cutoffs are UTC-month-floored. Partial coverage lists cold queries. |
| **status** | `agent status` | Newest eligible production run |
| **patterns** | `agent patterns` | Detector evidence paths from a cached run |
| **blueprint** | `agent blueprint` | Bun stack / lift from cached runs + pattern reports |
| **report** | `agent report` | Cross-dimension architecture summary |
| **run-research** | `agent run-research` | Spawns/runs the research pipeline (only live path) |

Start here when discovery or gate looks empty:

```bash
bun run agent ground
bun run agent ground --dimension=market-making
bun run agent ground --json --dimension=sports-nba
```

## Commands

```bash
bun run agent ground                    # discovery-grounded triage (sub-agents)
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
bun run agent ground --json
bun run agent status --json
bun run agent status --dimension=market-making
bun run agent patterns --json --dimension=market-making
bun run agent run-research --dimension=price-data --no-export-audit
bun run agent blueprint --json --no-write
```

A leading `--` before flags is tolerated for muscle memory (`agent status -- --dimension=x`) but prefer the forms above.

## `ground`

Cache-only orchestration. Four sections:

1. **status** — same production-run rules as `agent status`
2. **cache** — `search_cache` ready? `inspect_cache` distinct repo count
3. **miss** — discovery/gate miss from the run, or synthetic alternates from `dimensions.json` when no run
4. **next actions** — ordered probes (`research:dry`, `research`, `patterns`, `blueprint`, retry commands)

No `gh` / `Bun.fetch`. Safe under rate-limit pressure.

## `status`

Reads the newest eligible production run from `research/cache/cache.db`.

- No `--dimension` → latest run **across all dimensions**
- `--dimension=<id>` → that slice only (null / “none” when missing — no cross-dimension fallback)

Reports discovered → gated → shortlist and stale/freshness flags. On empty/miss, points at `agent ground` and `research:dry`.

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
