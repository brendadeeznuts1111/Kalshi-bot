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

4. **CLI surface** — update `docs/TENNIS_PROGRAM_ARCHETYPES.md` + `package.json` scripts if a compose script helps (`tennis:stack` optional; do not overbuild).

5. **Tests** — watch-set ticker selection; bridge-after-sync smoke with `:memory:` DB; no network in unit tests (inject `fetchImpl`).

## Hard rules

- Claim only tennis-lane files; leave other sessions' dirty work alone.
- No surname matcher as primary Kalshi↔Stadion join (existing bridge only).
- No Kalshi WS in this pass unless `WS_CUE` already forces it — REST watch-set first.
- `--dry-run` on live must keep working (no writes).
- Branded `CanonicalEventId`; no bare `eventId: string` on new APIs.
- Do not commit unless the user asks.

## Verify

```bash
bun test tests/institutions/live-scores.test.ts \
  tests/institutions/stadion-kalshi-bridge.test.ts \
  tests/institutions/tennis-ladder.test.ts \
  tests/institutions/itf-stadion.test.ts
bun run tennis:live -- --dry-run --json
# after watch wiring:
bun run tennis:record -- --watch --dry-run   # if dry-run added; else one-shot --watch with empty OK
```

## Done criteria

- Recorder can target watch-set without `--top`.
- Sync path can refresh `event_links`.
- One shared watch helper; tests green; archetypes doc lists the commands.
