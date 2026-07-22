# Committed audit evidence (JSONL)

One `*.jsonl` file per promoted repo (`owner__repo.jsonl`). Updated when you run:

```bash
bun run research -- --export-audit
# or
bun run export-audit -- --latest
```

Path SSOT: `src/research/paths.ts` (`auditEvidenceRelPath` / `auditEvidenceAbsPath`).
