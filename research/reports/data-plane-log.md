
---

## 2026-08-04 06:43 CDT

- `tennis:itf -- --sync`: OK (exit 0); synced 685 events / 1370 markets (1370 legs: open=462, closed=6, settled=902, retainDays=3). Bridge linked=1291, unmatched=291, ambiguous=1, resolutions+=1291.
- `tennis:collect -- --days=1`: OK — 2026-08-04 +112 events (112 singles / 0 doubles), updated=0; bridge linked=1403, ambiguous=1, unmatched=291, resolutions+=1403.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — watch=0, polled=0, live=0, would_upsert=0 (no live match window at 06:43 CDT).
- `rate-limit:status`: OK (exit 0) — code_search=10/10 (reset 2026-08-04T11:45:11Z), core=4989/5000, search=30/30. G0 still blocked; code_search bucket fully consumed until ~11:45Z.
- Row counts (event-store.db): events=5793, markets=8190, resolutions=3102, book_ticks=1967, event_links=1695, live_scores=10, score_snapshots=10.
- Drift/errors: no canary drift (exit 0); book_ticks flat at 1967 (kalshi-rest=1788 / kalshi-ws=179 unchanged); no orders placed, no src/ changes, no commit.
