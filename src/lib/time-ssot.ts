/**
 * Time unit SSOT for Kalshi-bot data planes.
 *
 * ## Conventions
 *
 * | Plane | Primary form | Unit |
 * | ----- | ------------ | ---- |
 * | live-tracker / analyze `time`, `at` | ISO-8601 UTC string | wall clock (`…Z`) |
 * | shadow log `ts`, toxicity due/mark | number | **Unix epoch milliseconds** |
 * | event-store `ts`, `recv_ts`, book ticks | number | **Unix epoch milliseconds** |
 * | CLI durations (`--seconds`, gaps) | number | seconds or ms (label in flag/field) |
 * | Shell settlement (85′, 24h, 5m lead) | domain | match minute / hours / minutes — **not** wall clock |
 *
 * **Interior math and joins use epoch milliseconds.**  
 * **Board/logs for humans use ISO UTC.** Convert at the boundary.
 *
 * @see docs/TIME.md
 */

/** Unix epoch milliseconds (Date.now() shape). */
export type EpochMs = number;

/** ISO-8601 UTC string (Date.toISOString() shape). */
export type IsoUtc = string;

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Wall clock now as ISO UTC. */
export function nowIsoUtc(now: EpochMs = Date.now()): IsoUtc {
  return new Date(now).toISOString();
}

/** Wall clock now as epoch ms. */
export function nowEpochMs(): EpochMs {
  return Date.now();
}

/**
 * Parse any common time wire into epoch ms, or null if invalid.
 * - number: treated as **ms** if |n| >= 1e12, else **seconds** (×1000)
 * - string: Date.parse (ISO preferred)
 */
export function toEpochMs(value: unknown): EpochMs | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Heuristic: 1e12 ms ≈ 2001-09; seconds since 1970 are ~1e9–1e10
    if (Math.abs(value) >= 1e12) return Math.trunc(value);
    if (Math.abs(value) >= 1e9) return Math.trunc(value * MS_PER_SECOND);
    return Math.trunc(value); // already small ms offset / relative — leave as-is
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
    // pure digits → number path
    if (/^-?\d+(\.\d+)?$/.test(t)) return toEpochMs(Number(t));
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Epoch ms → ISO UTC, or null. */
export function toIsoUtc(value: unknown): IsoUtc | null {
  const ms = toEpochMs(value);
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

/** Require epoch ms or throw (boundary parse). */
export function requireEpochMs(value: unknown, label = 'timestamp'): EpochMs {
  const ms = toEpochMs(value);
  if (ms == null) throw new Error(`${label}: invalid time ${String(value)}`);
  return ms;
}

/** Require ISO UTC or throw. */
export function requireIsoUtc(value: unknown, label = 'timestamp'): IsoUtc {
  const iso = toIsoUtc(value);
  if (iso == null) throw new Error(`${label}: invalid time ${String(value)}`);
  return iso;
}

/** Duration helpers (always return ms). */
export function secondsToMs(s: number): EpochMs {
  return Math.trunc(s * MS_PER_SECOND);
}
export function minutesToMs(m: number): EpochMs {
  return Math.trunc(m * MS_PER_MINUTE);
}
export function hoursToMs(h: number): EpochMs {
  return Math.trunc(h * MS_PER_HOUR);
}
export function msToSeconds(ms: EpochMs): number {
  return ms / MS_PER_SECOND;
}
export function msToMinutes(ms: EpochMs): number {
  return ms / MS_PER_MINUTE;
}

/**
 * Pair for dual-write rows: human ISO + joinable ms.
 * Prefer storing both on public boards; interior stores ms only.
 */
export function dualTime(value: unknown): { time: IsoUtc; timeMs: EpochMs } | null {
  const timeMs = toEpochMs(value);
  if (timeMs == null) return null;
  return { time: new Date(timeMs).toISOString(), timeMs };
}
