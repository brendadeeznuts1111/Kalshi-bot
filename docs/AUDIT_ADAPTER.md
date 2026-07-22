# Audit SSOT adapter

Draft bridge from Kalshi research `RepoReport` → monorepo `AuditFinding` / `AuditConcept` wire shapes. **No monorepo imports** — parse at the FactoryWager boundary with `lib/audit/parseAuditFinding`. Live finding ingested on rotor `feat/github-repository-ref`.

## Modules

| File | Role |
|------|------|
| `src/research/audit-adapter.ts` | Wire conversion, sha3-256 digests, high-value gate |
| `src/research/validate.ts` | Structural `RepoReport` validation (schema mirror) |
| `src/research/export-audit.ts` | Write NDJSON evidence + finding JSON + `rotor-ingest.json` |
| `research/schemas/repo-report.schema.json` | JSON Schema SSOT for `RepoReport` |

## High-value promotion

Shortlist repos become **high-value** audit candidates when:

- `score.total >= 70`
- `auth-api` and `order-realism` detectors matched
- Each contributes ≥ 15 points

## Watchlist tier

Repos below the high-value bar but still auditable export as **`meta.tier: "watchlist"`**, `status: "open"`:

- `score.total >= 65`
- `auth-api` and `order-realism` matched
- Each contributes ≥ 12 points

High-value takes precedence when both gates match. Constants: `WATCHLIST_MIN_*` in `constants.ts`.

Use `--export-audit` on the research CLI to emit after a run (both tiers).

## Evidence integrity (Phase 2)

1. **Line evidence** → JSONL (`application/jsonl`), one `EvidenceLine` per row under `research/audit-evidence/`. Bodies ≥ 4 KiB are stored as **zstd frames** (`Bun.zstdCompressSync`, level recorded in finding metadata).
2. **Dual digests** (both `sha3-256`):
   - **`digest`** — integrity anchor over **bytes as stored** (plain or zstd). Matches `sha3sum` / `openssl dgst -sha3-256` on the file on disk.
   - **`contentDigest`** — identity hash over the **decompressed NDJSON body** (dedupe / content equality; safe across recompression or level changes).
3. **Local cache fingerprint** → still `Bun.hash` in `evidenceFingerprint()` (fast, non-audit).
4. **Audit fingerprint** → `evidenceSha3Fingerprint()` / export line index (tamper-proof summary).

Monorepo schema requires `evidence.path` under `tools/audit-evidence/`. On ingest, remap (same stored bytes; rotor uses `.ndjson` because the monorepo gitignores `*.jsonl`):

```
research/audit-evidence/{owner}__{repo}.jsonl
  → tools/audit-evidence/kalshi/{owner}__{repo}.ndjson
```

Path SSOT: `src/research/paths.ts` (`auditEvidenceRelPath`, `AUDIT_EVIDENCE_DIR`).

## Diversity as AuditConcept

`shortlistRulesConcept()` encodes portfolio constraints as `kalshi-shortlist-diversity`:

- shortlist size, max per tag, major-tag minimum, TS tiebreak threshold
- `related`: `kalshi-shortlist-diversity`, `sha3-integrity`, `nagata-map`
- `relatedDocs`: `SHA3-256` (rotor curated token)

Findings link via `related: ["kalshi-shortlist-diversity", "sha3-integrity", "nagata-map"]`.

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
2. Copy evidence using `evidenceCopies` from `rotor-ingest.json` (Kalshi: `.jsonl` → rotor: `.ndjson`, same bytes).
3. Tamper check: `bun run export-audit -- --verify …` (stored `digest` + logical `contentDigest`).
4. `parseAuditFinding(wire)` → branded interior types at monorepo boundary.
5. Append to rotor catalog when emitter SSOT exists in `~/Projects`.

## Schema validation

Before ranking or export consumes a `RepoReport`:

```typescript
import { validateRepoReport } from "./validate.ts";
validateRepoReport(wire); // throws if structural mismatch
```

JSON Schema lives at `research/schemas/repo-report.schema.json` for external validators (CI, rotor).
