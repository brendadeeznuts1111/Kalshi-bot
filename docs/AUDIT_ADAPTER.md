# Audit SSOT adapter

Draft bridge from Kalshi research `RepoReport` → monorepo `AuditFinding` / `AuditConcept` wire shapes. **No monorepo imports** — parse at the FactoryWager boundary with `lib/audit/parseAuditFinding`.

## Modules

| File | Role |
|------|------|
| `src/research/audit-adapter.ts` | Wire conversion, sha3-256 digests, high-value gate |
| `src/research/validate.ts` | Structural `RepoReport` validation (schema mirror) |
| `src/research/export-audit.ts` | Write NDJSON evidence + finding JSON + `rotor-ingest.json` |
| `research/schemas/repo-report.schema.json` | JSON Schema SSOT for `RepoReport` |

## High-value promotion

Shortlist repos become audit candidates when:

- `score.total >= 70`
- `auth-api` and `order-realism` detectors matched (`DETECTOR_IDS` in `constants.ts`)
- Each contributes ≥ 15 points

Use `--export-audit` on the research CLI to emit after a run.

## Evidence integrity (Phase 2)

1. **Line evidence** → JSONL (`application/jsonl`), one `EvidenceLine` per row under `research/audit-evidence/`.
2. **Digest** → `Bun.CryptoHasher("sha3-256")` over the exact evidence file bytes (NDJSON + trailing newline when non-empty).
3. **Local cache fingerprint** → still `Bun.hash` in `evidenceFingerprint()` (fast, non-audit).
4. **Audit fingerprint** → `evidenceSha3Fingerprint()` / export digest (tamper-proof).

Monorepo schema requires `evidence.path` under `tools/audit-evidence/`. On ingest, remap:

```
research/audit-evidence/{owner}__{repo}.jsonl
  → tools/audit-evidence/kalshi/{owner}__{repo}.jsonl
```

Path SSOT: `src/research/paths.ts` (`auditEvidenceRelPath`, `AUDIT_EVIDENCE_DIR`).

## Diversity as AuditConcept

`shortlistRulesConcept()` encodes portfolio constraints as `kalshi-shortlist-diversity`:

- shortlist size, max per tag, major-tag minimum, TS tiebreak threshold
- `relatedDocs`: `URLPattern`, `docs/FACTOR_STACK.md`

Findings link via `related: ["kalshi-shortlist-diversity"]`.

## Rotor ingest (when emitter exists)

```bash
# During research run
bun run research -- --export-audit

# Re-export from cached run + verify digests
bun run export-audit -- --latest
bun run export-audit -- --verify research/exports/audit/{runId}
```

Each export includes `rotor-ingest.json` — monorepo-ready findings (paths under `tools/audit-evidence/kalshi/`) plus `evidenceCopies` for file sync.

Ingest steps:

1. Validate each `.repo-report.json` with `validateRepoReport` / schema.
2. Copy NDJSON using `evidenceCopies` from `rotor-ingest.json`.
3. Tamper check: `bun run export-audit -- --verify …` (sha3-256 over file bytes).
4. `parseAuditFinding(wire)` → branded interior types at monorepo boundary.
5. Append to rotor catalog when emitter SSOT exists in `~/Projects`.

## Schema validation

Before ranking or export consumes a `RepoReport`:

```typescript
import { validateRepoReport } from "./validate.ts";
validateRepoReport(wire); // throws if structural mismatch
```

JSON Schema lives at `research/schemas/repo-report.schema.json` for external validators (CI, rotor).
