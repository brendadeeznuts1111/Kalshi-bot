# Time unit SSOT

**Code:** [`src/lib/time-ssot.ts`](../src/lib/time-ssot.ts)

## Rule

| Use | Form | Unit |
| --- | ---- | ---- |
| Human boards, live-tracker logs, analyze `time` | ISO-8601 UTC string | wall clock ending in `Z` |
| Interior joins, shadow, book ticks, toxicity | `number` | **Unix epoch milliseconds** |
| CLI flags like `--seconds` | number | **seconds** (convert at boundary) |
| Shell settlement (85′, 24h, lead 5m) | domain label | match minute / hours / minutes — **not** event timestamps |

**Always convert at the plane boundary** with `toEpochMs` / `toIsoUtc` / `dualTime`.

```ts
import { dualTime, toEpochMs, toIsoUtc } from '../src/lib/time-ssot.ts';

dualTime('2026-08-10T10:00:02.000Z');
// → { time: '2026-08-10T10:00:02.000Z', timeMs: 1723284002000 }

toEpochMs(1723284002);      // seconds-sized → ×1000
toEpochMs(1723284002000);   // already ms
```

## Plane map

| Plane | Fields | Unit |
| ----- | ------ | ---- |
| live-tracker | `at`, `time` | ISO UTC |
| analyze table | `time` + **`timeMs`** | ISO + epoch ms |
| shadow log | `ts`, `dueTs`, `markedTs` | epoch ms |
| event-store books | `ts`, `recv_ts` | epoch ms (`source_clock` recv\|exchange) |
| watch lead / stale | `--lead`, 45m clear | minutes of wall clock |
| settlement rules | 85′, 24h, 72h | match / calendar — separate |

## Heuristic for numeric wire

`toEpochMs(n)`:

- `|n| ≥ 1e12` → treat as **ms**
- `|n| ≥ 1e9` → treat as **seconds** (×1000)
- else → leave as ms-scale relative (rare)

Prefer ISO or explicit ms to avoid ambiguity.
