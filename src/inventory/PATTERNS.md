# Inventory pattern SSOT

| Pattern | Location |
| ------- | -------- |
| CLI argv (`hasFlag` / `argValue` / `argValues`) | `src/cli/argv.ts` (tools/* + scripts + live-tracker) |
| Pandora timed listen | `openPandoraWindow` in `pandora-listen.ts` |
| Stream-list HTTP headers | `streamListHeaders()` in `stream-list-fetch.ts` |
| InventoryEvent → skin row | private `liveEventToRow`; plan via `upsertSkinLiveEvents({ dryRun: true })` / `planInventoryUpsert` |
| Public/dummy Fantasy profile | `publicFantasyProfile` in `public-profile.ts` |
| Human markdown tables | `event-lookup-format.ts` (cap detail; prefer `--json`) |
| Test fixtures | `tests/inventory/fixtures.ts` |
| Enrich quality (match-rate / miss reasons) | `enrich-quality.ts` + `diagnoseBookedMatch` |
| Enrich gates CLI | `--min-match-rate` · `--min-linked-pct` · `--fail-on-enrich-quality` |

Prefer import SSOT over local copies. Prefer delete/unexport over new layers.
