# Miss taxonomy — integration map

Self-remediating hints when research/agent pipelines miss expected data. Implementation order follows user priority (#1 → #2 → #8 → #3 → #4 → #5).

## Grounded triage

Operator entry for discovery / gate / cache misses — **cache-only** sub-agent mesh:

```bash
bun run agent ground                         # status + cache + miss + next actions
bun run agent ground --dimension=market-making
bun run agent ground --json
```

Maps to lanes below without hitting GitHub. Prefer this before burning `code_search` quota. See [`AGENT.md`](AGENT.md).

## Status

Run proof gate:

```bash
bun run agent ground           # discovery-grounded triage first
bun run miss-taxonomy:status   # lane checklist + symbol probes
bun run check                  # typecheck + full test suite
bun run rate-limit:status -- --gated=49 --uncached=49  # before live research
```

| # | Miss type | Owner lane | Status | Proof |
|---|-----------|------------|--------|-------|
| 1 | Gate miss (near-miss + retry) | core | **done** | `tests/gate-miss.test.ts` |
| 2 | Pattern miss (manual review hints) | core | **done** | `tests/pattern-miss.test.ts` |
| 8 | Rate-limit budget miss | core | **done** | `tests/github-rate-limit.test.ts` |
| 3 | Cross-dimension cache fallback | **A** | **done** | `tests/github-errors.test.ts`, `loadFallbackRunFromDb` |
| 4 | Staleness badges (🕒) | **B** | **done** | `tests/staleness-badge.test.ts` |
| 5 | Discovery miss (0 candidates) | **C** | **done** | `tests/discovery-miss.test.ts` |
| — | Discover vs apply gate split | core | **done** | `tests/discover-gate.test.ts` |
| — | Live market-making run (V5) | research | **blocked** | `code_search` quota — see [`ROADMAP.md`](ROADMAP.md) |
| — | Bot scaffold | agent | **planned** | after V5 green |
| — | Inspect miss (detector rationale) | C+ | pending | extend pattern-miss |
| — | Verification miss (export-audit cmd) | D | pending | error wire alternative |
| — | Data fill (price-data run) | **D** | blocked | rate-limit preflight |

## Sub-agent scopes

### Lane A — Cross-dimension cache (#3)

**Goal:** When rate limit blocks live API and the current dimension has no prior run, suggest a cached run from another dimension that inspected overlapping repos.

**Touch (disjoint):**

- `src/research/cache.ts` — `loadFallbackRunFromDb({ dimension })` scanning recent runs across dimensions
- `src/research/github-error-enrichment.ts` — prefer dimension run, else cross-dimension fallback; set `staleDataSourceDimension`
- `src/research/github-errors.ts` — wire field in impact + remediation copy (`use_cached_run` mentions source dimension)
- `tests/github-errors.test.ts` — unit tests with mocked enrichment overrides

**Acceptance:**

- `serializeGitHubApiError` remediation command uses fallback run when dimension-local run absent
- Cross-dimension alternative string names source dimension
- `bun run check` green

### Lane B — Staleness badges (#4)

**Goal:** Surface 🕒 when results rely on stale inspect cache or aged prior run data.

**Touch (disjoint):**

- `src/agent/freshness.ts` — `formatDataFreshnessSuffix` / `formatTierBadge` / `resolveRunDataFreshness`
- `src/agent/lift.ts`, `src/agent/pattern-extract.ts`, `src/agent/architecture-blueprint.ts` — pass stale flags from run cache stats / run age
- `tests/staleness-badge.test.ts` — badge strings for fresh vs stale

**Acceptance:**

- Stale inspect/run → badge includes `🕒` and optional age
- Fresh tier badges unchanged (`high-value` / `watchlist` / `scored`)
- `bun run check` green

### Lane C — Discovery miss (#5)

**Goal:** When discovery returns 0 candidates, emit query proposals from `research/dimensions.json`.

**Touch (disjoint):**

- `src/research/discovery-miss.ts` (new) — `analyzeDiscoveryMiss(dimension, queries, gate)`
- `src/research/types.ts` — optional `discoveryMiss` on `ResearchRun`
- `src/research/cli.ts`, `src/research/report.ts`, `src/agent/architecture-blueprint.ts` — attach + render
- `tests/discovery-miss.test.ts`

**Acceptance:**

- Zero discovered → markdown section with 2–3 alternate query suggestions
- Non-zero discovered → no `discoveryMiss` field
- `bun run check` green

### Lane D — Data fill (blocked)

**Blocked on GitHub `code_search` quota (~1029 calls for price-data).**

```bash
bun run rate-limit:status -- --gated=49 --uncached=49
# when green:
GITHUB_RATE_LIMIT_WAIT=1 bun run research -- --dimension=price-data --min-stars=1 --min-forks=0 --export-audit
bun run agent blueprint
bun run reports:restore   # if tests touched committed artifacts
```

## Architecture (unchanged)

```
Parent TTY     → Bun.inspect.table, OSC 8 links
IPC child      → process.send progress; skips stdout summary
Standalone CLI → full summary on stdout
gh subprocess  → Bun.$ pipes
```

Rate-limit workflow integrates miss #8 preflight before discover/inspect batches.
