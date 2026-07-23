# Data-plane log (G3 keeper)

Daily entries from the data-plane keeper run. Newest at the bottom.

---

## 2026-07-23 06:43 CDT

- `tennis:itf -- --sync`: OK (exit 0); Kalshi ITF board rendered, ~35 listed markets incl. doubles.
- `tennis:collect -- --days=1`: OK — 2026-07-23 +70 events (70 singles / 0 doubles), updated=0; bridge linked=566, ambiguous=0, unmatched=158, resolutions+=566.
- `tennis:live -- --canary`: OK, exit 0, wire_ok=true — but watch=0/polled=0 (no live match window at 06:43 CDT; canary green on an empty watch set).
- `rate-limit:status`: FAILED (exit 1) — gh keyring token for account brendadeeznuts1111 invalid; GH_TOKEN/GITHUB_TOKEN unset. G0 code_search bucket unreadable; operator action: `gh auth login -h github.com`.
- Row counts (event-store.db): events=2001, markets=2552, resolutions=1291 (trading=1291), book_ticks=1875 (kalshi-rest 1696 / kalshi-ws 179), event_links=724, live_scores=10, score_snapshots=10.
- Drift/errors: no canary drift (exit 0); book_ticks unchanged vs 2026-07-23 G3 note (1875) — WS watch-set coverage gap (with_ws=0/78) still open; no orders placed, no src/ changes, no commit.
