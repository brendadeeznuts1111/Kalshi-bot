# Research roadmap — path to a working shortlist

Single source for **what we built**, **what ships next**, and **how we prove success**. Pipeline design detail stays in [`PLAN.md`](PLAN.md); miss taxonomy in [`MISS_TAXONOMY.md`](MISS_TAXONOMY.md).

## North star

End-to-end loop an operator can run without spelunking:

1. **Discover + score** repos per dimension (`bun run research`)
2. **Diagnose misses** (gate, discovery, rate limit) with actionable retries
3. **Browse reports** (`bun run serve`) or terminal (`bun run report:term`)
4. **Extract patterns + blueprint** from `cache.db` → composite bot scaffold (not live trading)

Success is a **green live run** on `market-making`, audit export, pattern report, and blueprint — with committed proof artifacts.

## Phase map (as-built → next)

| Phase | Scope | Status | Proof |
|-------|--------|--------|-------|
| **Core pipeline** | discover → gate → inspect → score → report | **done** | `bun run research`, `bun test` |
| **Miss taxonomy #1–5, #8** | gate / pattern / discovery / rate-limit / cache fallback | **done** | [`MISS_TAXONOMY.md`](MISS_TAXONOMY.md) |
| **Discover vs apply gate** | broad discover, strict apply for gate-miss proofs | **done** | `tests/discover-gate.test.ts` |
| **Evidence dual-hash** | `digest` + `contentDigest` on zstd NDJSON | **done** | [`AUDIT_ADAPTER.md`](AUDIT_ADAPTER.md) |
| **Agent CLI (no dashboard)** | status / patterns / blueprint / report over `cache.db` | **done** | [`AGENT.md`](AGENT.md) |
| **V5 — Live MM happy path** | Full `market-making` run with inspect when quota allows | **blocked** | `code_search` multi-wave (see blockers) |
| **4 — Bot scaffold** | Composite repo layout from lift + patterns (no live orders) | **planned** | after V5 green run |

## Current blockers

| Blocker | Impact | Unblock |
|---------|--------|---------|
| **`code_search` economics** | One-shot inspect blocked even when bucket is full (10/10): ~21 queries/repo × N uncached ≫ 10/min | `GITHUB_RATE_LIMIT_WAIT=1` (multi-wave), tighter `--min-stars`, or warm real `inspect_cache`; `bun run rate-limit:status` |
| **Agent vs report SSOT** | Polluted `cache.db` can make `agent ground` disagree with committed `latest-*.md` | Synthetic shortlists (`description:"test"` + 100★) are fixtures; `purgeIneligibleRuns({ purgeTestInspect: true })` after test leaks |
| **CI** | Remote PRs need the same gate as local pre-commit | `.github/workflows/check.yml` runs `bun run check`; local: `bun run hooks:install` |

## Daily operator loop

```bash
bun run check                   # typecheck + full suite + artifact restore

# Offline understanding (zero live GitHub — needs warmed search_cache)
bun run research:dry -- --dimension=market-making --json
# same as: bun run research -- --dry-run --offline --dimension=market-making
bun run agent status --json   # any-dimension latest (matches serve /)
bun run report:term
bun run agent blueprint --no-write

# Before live research
bun run rate-limit:status -- --gated=49 --uncached=49

# Live dry-run (discover + rate_limit only — still hits GitHub search)
bun run research -- --dry-run --dimension=market-making

# Gate-miss proof (0 inspect calls)
bun run research -- --dimension=sports-nba --min-stars=4 --export-audit

# When quota green — target dimension
bun run research -- --dimension=market-making --export-audit
bun run agent patterns --dimension=market-making
bun run agent blueprint
bun run serve
```

## Proof checklist (ship gate)

- [ ] `bun run check` green
- [ ] `bun run miss-taxonomy:status` — lanes 1–5, 8 show done
- [ ] For dimension under test: committed `latest-{dimension}.md` matches sqlite SSOT after run
- [ ] Gate-miss run: `Discovered > 0`, `Gated = 0`, `Inspected = 0`, report shows retry command

## Doc map

| Doc | Role |
|-----|------|
| [`ROADMAP.md`](ROADMAP.md) | This file — phases, blockers, proof gates |
| [`TENNIS_PROGRAM_ARCHETYPES.md`](TENNIS_PROGRAM_ARCHETYPES.md) | Tour sharp vs Challenger/ITF self-model; provenance; ladder recorder |
| [`PLAN.md`](PLAN.md) | As-built pipeline architecture |
| [`AGENT.md`](AGENT.md) | CLI over cache.db |
| [`MISS_TAXONOMY.md`](MISS_TAXONOMY.md) | Miss types + lane ownership |
| [`AUDIT_ADAPTER.md`](AUDIT_ADAPTER.md) | Evidence export + integrity |
| [`CRON.md`](CRON.md) | OS-level scheduling |
| [`BUN_NATIVE.md`](BUN_NATIVE.md) | Bun API map |
