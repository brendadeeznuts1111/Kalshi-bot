# Time unit SSOT (deep)

**Code:** [`src/lib/time-ssot.ts`](../src/lib/time-ssot.ts)

## Dual convention (non-negotiable)

| Form | Type alias | Unit / shape | Use |
| ---- | ---------- | ------------ | --- |
| **Wall** | `IsoUtc` | ISO-8601 UTC (`2026-08-10T10:00:02.000Z`) | Humans, live-tracker logs, JSONL `at`/`time` |
| **Interior** | `EpochMs` | Unix epoch **milliseconds** | Joins, gaps, toxicity, book ticks, shadow `ts` |

```ts
import { dualTime, stampInstant, toEpochMs, ageMs, isStale } from '../src/lib/time-ssot.ts';

dualTime('2026-08-10T10:00:02.000Z');
// → { time: '…Z', timeMs: 1786356002000 }

stampInstant(Date.now(), 'recv');
// → { time, timeMs, sourceClock: 'recv' }
```

## Plane map (deep)

| Plane | Fields | Form | Notes |
| ----- | ------ | ---- | ----- |
| **live-tracker event** | `time` + **`timeMs`** | dual | Minted on watch update; **backfilled on load** |
| **live-tracker log record** | `at` (+ optional `atMs`) | ISO (+ ms) | JSONL line envelope |
| **analyze flat row** | `time`, `timeMs` | dual | Schema field list includes both |
| **shadow prediction** | `ts`, `dueTs`, `markedTs` | epoch ms | Toxicity due = fill + `TOXICITY_DUE_OFFSET_MS` (60s) |
| **event-store books** | `ts`, `recv_ts` | epoch ms | `source_clock`: `recv` \| `exchange` |
| **live scores** | `updated_ts`, poll | epoch ms | Stale clear: `TENNIS_LIVE_STALE_MS` = 45m |
| **watch window** | `start_ts`, `--lead` | API + minutes | Lead default **5 minutes** wall |
| **CLI** | `--seconds`, `--interval` | **seconds** | Convert with `secondsToMs` at boundary |
| **settlement rules** | 85′, 24h, 72h | domain | Match minute / calendar — **not** event stamps |

## Provenance (`TimeSourceClock`)

| Value | Meaning |
| ----- | ------- |
| `recv` | Stamped on our host at receipt |
| `exchange` | Provider/exchange clock (e.g. WS `ts_ms`) |
| `wall` | Operator/board ISO |
| `derived` | Converted from another unit |

Mirrors event-store `source_clock` vocabulary.

## Numeric wire heuristic (`toEpochMs`)

| Abs value | Interpretation |
| --------- | ---------------- |
| `≥ 1e12` | Already **ms** |
| `≥ 1e9` | Unix **seconds** → ×1000 (Kalshi-style) |
| else | Relative ms / offset |

Prefer ISO or `epochFromUnit(n, 's'\|'ms')` when the API documents the unit.

## Shared duration pins

| Constant | Value | Plane |
| -------- | ----- | ----- |
| `TOXICITY_DUE_OFFSET_MS` | 60_000 | shadow T+60s mid |
| `TOXICITY_MARK_WINDOW_MS` | 15_000 | mark validity window |
| Tennis lead / stale | see `tennis-lane-constants.ts` | still minutes/ms there; convert via helpers |

## Analyze table

28+ fields: human `time` **and** joinable `timeMs`.

```bash
bun live-tracker.ts analyze --sport=tennis --phase=live --table --no-color
# columns include time, timeMs, …
```

## Book ticks dual-clock

```ts
import { bookTickClocks } from '../src/lib/time-ssot.ts';

bookTickClocks({ exchangeTsMs: msg.ts_ms, recvTsMs: recvTs });
// → { ts, recvTs, sourceClock: 'exchange' | 'recv' }
```

| Path | Source | Clocks |
| ---- | ------ | ------ |
| WS (`kalshi-ws-recorder`) | `kalshi-ws` | `bookTickClocks({ exchangeTsMs: msg.ts_ms?, recvTsMs })` |
| REST (`kalshi-itf-sync` `recordKalshiBookTicks`) | `kalshi-rest` | `bookTickClocks({ recvTsMs })` only → `source_clock=recv` |

## Watch window

```ts
import { watchWindowMs, startTsInWatchWindow, normalizeStartTs } from '../src/lib/time-ssot.ts';

watchWindowMs({ leadMinutes: 5, pastGraceHours: 6 });
// → { nowMs, windowStartMs, windowEndMs }

normalizeStartTs(event.start_ts); // ISO or unix → dual
startTsInWatchWindow(event.start_ts, { leadMinutes: 5, pastGraceHours: 6 });
```

**Wired consumers:**

| Consumer | How |
| -------- | --- |
| `listWatchEvents` (`live-scores.ts`) | `watchWindowMs` → ISO `$floor` / `$cutoff` for `events.start_ts` text compare |
| `clearStaleLiveFlags` | `nowEpochMs()` default; stale pin `TENNIS_LIVE_STALE_MS` |
| `analyzeScoreSnapshotCadence` | default 6h via `hoursToMs(6)` |
| Unit membership checks | `startTsInWatchWindow` |

Tennis lead/stale durations in `tennis-lane-constants.ts` use `minutesToMs` / `hoursToMs` from this module.

## Live-tracker JSONL (on-disk)

Every append via `appendTrackerLog` runs `stampTrackerLogRecord`:

```json
{
  "at": "2026-08-10T10:00:02.000Z",
  "atMs": 1786356002000,
  "eventId": 197510101,
  "events": [
    { "time": "2026-08-10T10:00:02.000Z", "timeMs": 1786356002000, "eventType": "PRICE_CHANGE", "…" : "…" }
  ]
}
```

Legacy lines without `timeMs` are backfilled on load.

## Anti-patterns

- Storing only ISO and re-parsing on every join without caching `timeMs`
- Mixing shadow `ts` (ms) with live-tracker `time` (ISO) without `toEpochMs`
- Treating settlement “85 minutes” as wall-clock ms
- Assuming Kalshi `start_ts` is always ms — use `epochFromUnit` / `normalizeStartTs`
- Hand-rolling exchange vs recv book clocks — use `bookTickClocks`
