---
name: tennis-infra-integrate
description: >-
  Deep-integrate Kalshi-bot tennis pipes: watch-set recorder, live_data early-start,
  Stadion bridge after sync, CLI cohesion. Use when the user asks to integrate
  tennis infra, /tennis-integrate, or after tennis-infra-review.
disable-model-invocation: true
---

# Tennis infra integrate

Implement the control plane so collect / live / record share one watch membership model. Prefer small diffs in the tennis lane only.

## SSOT docs

- `docs/TENNIS_PROGRAM_ARCHETYPES.md`
- Skills: `tennis-infra-review` (defects), this skill (wiring)

## Target architecture

```
sync (Kalshi REST)
  → events/markets (competitor UUID event_id)
live poll (milestones + live_data)
  → live_scores.is_live / score_snapshots (source_clock=recv)
watch set = start_ts ≤ now+lead OR is_live
record
  → book_ticks for watch-set tickers (not vanity --top alone)
collect (Stadion)
  → events + resolutions (stadion ids)
bridge
  → event_links + resolution on Kalshi event_id
```

## Required integration work (do these)

1. **Recorder watch mode** — `tennis:record -- --watch` (or default under `--loop`):
   - Poll books for `listWatchEvents` / markets under those `event_id`s.
   - Keep `--top=N` as explicit override for volume sampling.
   - Reuse lead minutes (`--lead`, default 5) aligned with `tennis:live`.

2. **Bridge after Kalshi sync** — when `tennis:itf -- --sync` or record sync finishes, call `bridgeStadionToKalshi` (or document `--bridge` flag). Collect already bridges; sync side is the gap.

3. **Live → record handoff** — export a single helper used by both CLIs, e.g. `listRecordTickers(db, { leadMinutes, limit })` in `live-scores.ts` or a thin `watch-set.ts`. No duplicated SQL.

4. **CLI surface** — `docs/TENNIS_PROGRAM_ARCHETYPES.md` + `package.json` (`tennis:ws-ground`, `tennis:record --ws`).

5. **WS book lane** — `kalshi-ws-recorder.ts` + `tennis-ws-*` modules; stream seq per `sid`; `tennis-ws-recorder-store` history; ground via `Bun.WebView`/`Bun.Image`. See `tennis-ws-lane.ts`.

6. **Tests** — watch-set, bridge, orderbook-stream, kalshi-ws-recorder, tennis-book-coverage, tennis-ws-recorder-store; no network (inject `wsFactory`).

## Hard rules

- Claim only tennis-lane files; leave other sessions' dirty work alone.
- No surname matcher as primary Kalshi↔Stadion join (existing bridge only).
- No Kalshi WS in this pass unless extending the **done** WS lane (`kalshi-ws-recorder`, `tennis-ws-*`) — do not duplicate wire code.
- `--dry-run` on live must keep working (no writes).
- Branded `CanonicalEventId`; no bare `eventId: string` on new APIs.
- Do not commit unless the user asks.

## Verify

```bash
bun test tests/institutions/live-scores.test.ts \
  tests/institutions/watch-set.test.ts \
  tests/institutions/stadion-kalshi-bridge.test.ts \
  tests/institutions/orderbook-stream.test.ts \
  tests/institutions/kalshi-ws-recorder.test.ts \
  tests/institutions/tennis-book-coverage.test.ts \
  tests/institutions/tennis-ws-recorder-store.test.ts \
  tests/institutions/tennis-ws-dashboard.test.ts \
  tests/agent/tennis-ground.test.ts
bun run agent tennis
bun run tennis:record -- --ws --dry-run
bun run tennis:ws-ground -- --html-only
```

## Done criteria

- Recorder targets watch-set without `--top`; sync refreshes `event_links`.
- WS lane: stream seq per sid, session history, WebView ground, `agent tennis` reads artifacts.
- One shared watch helper; tests green; archetypes doc lists commands + file naming.
