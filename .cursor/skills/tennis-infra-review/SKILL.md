---
name: tennis-infra-review
description: >-
  Defect-first review of Kalshi-bot tennis event-store infra (Stadion collector,
  surname-day-lane bridge, live_data watch set, ladder recorder). Use when the
  user asks for tennis infra review, /tennis-review, or before integrating
  recorder↔live↔bridge.
disable-model-invocation: true
---

# Tennis infra review

Read-only. Do not edit files, commit, or push.

## Scope (lane)

```
src/institutions/event-store/
src/bot/kalshi-live-data.ts
src/bot/kalshi-events-api.ts
src/bot/kalshi-market-data.ts
src/bot/kalshi-ws.ts
src/bot/kalshi-auth.ts
src/alpha/ticker-formats/itf.ts
tools/tennis/
tests/institutions/{itf-stadion,stadion-kalshi-bridge,live-scores,watch-set,tennis-ladder,kalshi-event-id,kalshi-itf-sync,open-db,ws-recorder-schedule,kalshi-ws-recorder,orderbook-stream,orderbook-live,tennis-book-coverage,tennis-ws-*,live-canary-store}*
tests/bot/{kalshi-live-data,kalshi-auth}.test.ts
tests/agent/tennis-ground.test.ts
tests/alpha/ticker-formats/itf.test.ts
docs/TENNIS_PROGRAM_ARCHETYPES.md
docs/BUN_NATIVE.md
.cursor/skills/plan/SKILL.md
```

Ignore unrelated dirty files (NBA/MLB alpha, research CLI) unless they import this lane.

## Doctrine

1. **Identity:** Kalshi events key on competitor UUID pair (+ series + start). Never surname-first-hit as sole join for trading. Bridge hard-fails ambiguous keys.
2. **Namespaces:** Stadion `itf|stadion|{matchId}` ≠ Kalshi mint. Join only via `event_links`.
3. **Clocks:** label `source_clock` (`recv` vs Kalshi server `ts`). Live_data has no point clock — RQ12 lies if unlabeled.
4. **Watch set:** `start_ts - lead` OR `live_scores.is_live`. REST `active` ≠ live.
5. **Provenance:** primary facts need `source` / `source_url` / `fetched_ts` / `corpus=trading`.
6. **ITF tour parse:** must not match `/men/` inside `"women"`.

## How to review

1. `git status` + `git diff` limited to the lane above (uncommitted + untracked).
2. Read call graphs: `collect` → bridge; `live` → watch → milestones → live_data → upsert; `record` → books.
3. Run: `bun test tests/institutions/itf-stadion.test.ts tests/institutions/stadion-kalshi-bridge.test.ts tests/institutions/live-scores.test.ts tests/institutions/watch-set.test.ts tests/institutions/tennis-ladder.test.ts tests/institutions/kalshi-event-id.test.ts tests/institutions/kalshi-itf-sync.test.ts tests/bot/kalshi-live-data.test.ts`
4. Flag only actionable defects introduced or exposed by this lane.

## Output format

Findings first, severity-ordered:

`[P0|P1|P2] Title — path:line`

One short paragraph each: scenario + why wrong + fix hint.

Then:

### Integration gaps
Bullet list of missing wires (e.g. recorder not on watch set) — not style nits.

### Test gaps
Missing cases that would catch the P0/P1s.

Do not propose unrelated refactors.
