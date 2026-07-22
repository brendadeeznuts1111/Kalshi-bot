# Committed audit evidence (JSONL)

One `*.jsonl` file per **exported** shortlist repo (`owner__repo.jsonl`). Updated when you run:

```bash
bun run research -- --export-audit
# or
bun run export-audit -- --latest
# or single repo
bun run export-audit -- --run <run-id> --repo owner/repo
```

**Tiers:** high-value (≥70 / auth+order ≥15) and watchlist (≥65 / auth+order ≥12). See [`docs/AUDIT_ADAPTER.md`](../docs/AUDIT_ADAPTER.md).

**Rotor ingest:** copy bytes to `tools/audit-evidence/kalshi/*.ndjson` in the monorepo (same content; monorepo gitignores `*.jsonl`). Digest is over file bytes — extension does not change the hash.

Path SSOT: [`src/research/paths.ts`](../src/research/paths.ts) (`auditEvidenceRelPath`, `auditEvidenceAbsPath`).
