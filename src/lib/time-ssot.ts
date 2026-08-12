/**
 * Time unit SSOT for Kalshi-bot data planes.
 *
 * ## Dual convention
 *
 * | Form | Type | Unit / shape |
 * | ---- | ---- | ------------ |
 * | **Wall (human)** | `IsoUtc` string | ISO-8601 UTC (`…Z`) |
 * | **Interior (join)** | `EpochMs` number | Unix epoch **milliseconds** |
 *
 * Board/logs dual-write when possible (`dualTime` / `stampInstant`).
 * Math, gaps, toxicity, book ticks, and cross-plane joins use **ms only**.
 *
 * Domain thresholds (tennis lead minutes, soccer 85′, 24h interrupt) are
 * **not** wall-clock stamps — use `minutesToMs` / `hoursToMs` at the edge.
 *
 * @see docs/TIME.md
 */

// ── Brands (nominal via docs; plain numbers at runtime) ─────────────────────

/** Unix epoch milliseconds (`Date.now()` shape). */
export type EpochMs = number;

/** ISO-8601 UTC string (`Date.toISOString()` shape). */
export type IsoUtc = string;

/**
 * Provenance of a timestamp — mirrors event-store `source_clock` idea.
 * - `recv` — stamped on our machine at receipt
 * - `exchange` — provider/exchange clock when present
 * - `wall` — operator/human ISO board time
 * - `derived` — converted from another unit
 */
export type TimeSourceClock = 'recv' | 'exchange' | 'wall' | 'derived';

/** Dual-write instant for public rows. */
export type DualInstant = {
  time: IsoUtc;
  timeMs: EpochMs;
};

/** Full stamped instant with provenance. */
export type ClockedInstant = DualInstant & {
  sourceClock: TimeSourceClock;
};

// ── Constants ──────────────────────────────────────────────────────────────

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Below this abs value, numeric wire is treated as relative ms (not unix). */
export const EPOCH_MS_ABS_MIN = 1e12;
/** Below this (but ≥1e9), numeric wire is treated as unix **seconds**. */
export const EPOCH_SEC_ABS_MIN = 1e9;

// ── Now ────────────────────────────────────────────────────────────────────

export function nowEpochMs(): EpochMs {
  return Date.now();
}

export function nowIsoUtc(now: EpochMs = Date.now()): IsoUtc {
  return new Date(now).toISOString();
}

export function stampNow(sourceClock: TimeSourceClock = 'recv'): ClockedInstant {
  const timeMs = nowEpochMs();
  return { time: new Date(timeMs).toISOString(), timeMs, sourceClock };
}

// ── Parse / format ─────────────────────────────────────────────────────────

/**
 * Parse common wire into epoch ms, or null if invalid.
 *
 * Numbers:
 * - `|n| ≥ 1e12` → already **ms**
 * - `|n| ≥ 1e9` → **seconds** (×1000) — Kalshi-style unix sec
 * - else → treat as relative ms (offsets)
 *
 * Strings: ISO via `Date.parse`, or pure numeric string via number path.
 */
export function toEpochMs(value: unknown): EpochMs | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) >= EPOCH_MS_ABS_MIN) return Math.trunc(value);
    if (Math.abs(value) >= EPOCH_SEC_ABS_MIN) return Math.trunc(value * MS_PER_SECOND);
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return null;
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

export function toIsoUtc(value: unknown): IsoUtc | null {
  const ms = toEpochMs(value);
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

export function requireEpochMs(value: unknown, label = 'timestamp'): EpochMs {
  const ms = toEpochMs(value);
  if (ms == null) throw new Error(`${label}: invalid time ${String(value)}`);
  return ms;
}

export function requireIsoUtc(value: unknown, label = 'timestamp'): IsoUtc {
  const iso = toIsoUtc(value);
  if (iso == null) throw new Error(`${label}: invalid time ${String(value)}`);
  return iso;
}

/**
 * Dual-write pair for board rows.
 * Normalizes ISO (so fractional/Z form is canonical).
 */
export function dualTime(value: unknown): DualInstant | null {
  const timeMs = toEpochMs(value);
  if (timeMs == null) return null;
  return { time: new Date(timeMs).toISOString(), timeMs };
}

export function stampInstant(
  value: unknown,
  sourceClock: TimeSourceClock = 'derived',
): ClockedInstant | null {
  const d = dualTime(value);
  if (!d) return null;
  return { ...d, sourceClock };
}

/**
 * Explicit unit parse when the wire documents seconds vs ms
 * (avoids heuristic for Kalshi start_ts etc.).
 */
export function epochFromUnit(
  value: number,
  unit: 'ms' | 's',
): EpochMs | null {
  if (!Number.isFinite(value)) return null;
  return unit === 's' ? Math.trunc(value * MS_PER_SECOND) : Math.trunc(value);
}

// ── Duration ───────────────────────────────────────────────────────────────

export function secondsToMs(s: number): EpochMs {
  return Math.trunc(s * MS_PER_SECOND);
}
export function minutesToMs(m: number): EpochMs {
  return Math.trunc(m * MS_PER_MINUTE);
}
export function hoursToMs(h: number): EpochMs {
  return Math.trunc(h * MS_PER_HOUR);
}
export function daysToMs(d: number): EpochMs {
  return Math.trunc(d * MS_PER_DAY);
}
export function msToSeconds(ms: EpochMs): number {
  return ms / MS_PER_SECOND;
}
export function msToMinutes(ms: EpochMs): number {
  return ms / MS_PER_MINUTE;
}
export function msToHours(ms: EpochMs): number {
  return ms / MS_PER_HOUR;
}

/** Age of `then` relative to `now` (positive if then is in the past). */
export function ageMs(then: unknown, now: EpochMs = Date.now()): EpochMs | null {
  const t = toEpochMs(then);
  if (t == null) return null;
  return now - t;
}

export function isStale(
  then: unknown,
  maxAgeMs: EpochMs,
  now: EpochMs = Date.now(),
): boolean {
  const age = ageMs(then, now);
  if (age == null) return true;
  return age > maxAgeMs;
}

/** Compact duration for logs: `1.5s`, `45m`, `2.0h`. */
export function formatDurationMs(ms: number): string {
  const a = Math.abs(ms);
  if (a < MS_PER_SECOND) return `${Math.round(ms)}ms`;
  if (a < MS_PER_MINUTE) return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  if (a < MS_PER_HOUR) return `${(ms / MS_PER_MINUTE).toFixed(1)}m`;
  if (a < MS_PER_DAY) return `${(ms / MS_PER_HOUR).toFixed(1)}h`;
  return `${(ms / MS_PER_DAY).toFixed(1)}d`;
}

/**
 * Sort key: prefer timeMs, else parse time ISO.
 * Returns -∞ for missing so bad rows sort first (or last with reverse).
 */
export function sortKeyEpochMs(row: { timeMs?: unknown; time?: unknown; ts?: unknown }): EpochMs {
  return (
    toEpochMs(row.timeMs) ??
    toEpochMs(row.ts) ??
    toEpochMs(row.time) ??
    Number.NEGATIVE_INFINITY
  );
}

/** Compare two dual/ISO/ms values for sort (−1 / 0 / 1). */
export function compareTime(a: unknown, b: unknown): number {
  const am = toEpochMs(a);
  const bm = toEpochMs(b);
  if (am == null && bm == null) return 0;
  if (am == null) return -1;
  if (bm == null) return 1;
  return am === bm ? 0 : am < bm ? -1 : 1;
}

// ── Domain duration pins (imported by lanes; single place to look) ──────────

/** Toxicity mark due offset (shadow) — T+60s mid. */
export const TOXICITY_DUE_OFFSET_MS = 60_000;
/** Toxicity valid mark window after due. */
export const TOXICITY_MARK_WINDOW_MS = 15_000;

/** Live-tracker default watch window when documented as seconds. */
export function cliSecondsToMs(seconds: number): EpochMs {
  return secondsToMs(seconds);
}
