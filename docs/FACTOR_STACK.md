# Factor stack — scoring SSOT

Hierarchical evidence model for Kalshi GitHub bot research. Locked as part of **2+4** (local types + this doc). Local audit adapter is **implemented**; monorepo catalog ingest is wired via rotor (`tools/audit-findings/`).

## Scopes (inside → out)

| # | Scope | Type artifact | Scoring tie-in |
|---|--------|---------------|----------------|
| 1 | **Line** | `EvidenceLine` | Auth 25 + orders 25 — finest falsifiable match |
| 2 | **File** | `DetectorResult` (partial) | Dry-run vs live-capable separation |
| 3 | **Module** | `RepoReport.liftNotes` | Liftability verdict (what to extract) |
| 4 | **Repo** | `DetectorResult` | Tests 15 + docs 15 + maintenance 10 |
| 5 | **Strategy** | tags + risk detector | Risk 10 + `strategyTags` |
| 6 | **Shortlist** | `ResearchRun.shortlist` | Diversity: min 1/major tag, max 4/tag, size 12 |

## Two gates · one rank · portfolio last

1. **Popularity gate** (`gate.ts`) — before inspect. ≥5 stars OR ≥3 forks, not archived, pushed within 18 months.
2. **Quality rank** (`score.ts`) — six components on gated repos. Line-level auth/order dominate (50/100) but are **rank components**, not hard excludes today.
3. **Shortlist portfolio** (`diversify.ts`) — constraints above any single repo.

**Principle:** granular line evidence dominates rank; shortlist decisions exist only at portfolio scope.

## Types (`src/research/types.ts`)

```typescript
EvidenceLine   // { query, path, component }
DetectorResult // { id, component, scope, matched, pointsContributed, maxPoints, evidence, rationale }
RepoReport     // { fullName, score, detectors, liftNotes, strategyTags, generatedAt }
```

Built by `buildRepoReport()` in `src/research/evidence.ts`.

## Weights (`research/weights.json`)

| Component | Max pts | Scope |
|-----------|---------|-------|
| authApi | 25 | Line |
| orderRealism | 25 | Line |
| testsCi | 15 | Repo |
| docsSetup | 15 | Repo |
| maintenance | 10 | Repo |
| riskControls | 10 | Strategy |
| license | −15 penalty | Repo |

## Debug lens

| Symptom | Scope | Fix |
|---------|-------|-----|
| False auth/order hit | Line | `keywords.json`, evidence paths |
| Paper vs live wrong | File | order + dry-run detectors |
| Vague lift notes | Module | `deriveLiftNotes()` heuristics |
| Hygiene inflated | Repo | maintenance signal |
| Wrong tag | Strategy | `detectStrategyTags` + code |
| Strong repo excluded | Shortlist | `diversify.ts` caps |

## Audit SSOT parallel

| Kalshi | Monorepo |
|--------|----------|
| `EvidenceLine` NDJSON + sha3-256 | `AuditEvidence` |
| `RepoReport` | `AuditFinding` |
| `shortlistRulesConcept()` | `AuditConcept` (`kalshi-shortlist-diversity`) |
| `research/schemas/repo-report.schema.json` | `audit-finding.schema.json` |

Draft adapter: `src/research/audit-adapter.ts` · export: `--export-audit` · [AUDIT_ADAPTER.md](./AUDIT_ADAPTER.md)

Optional rotor ingest is write-only via `--export-audit` — this project does not read pulse or audit-catalog.
