/**
 * Tennis institution lane — shared defaults and wire tokens (SSOT).
 *
 * Watch-set, recorders, ground capture, and alpha book-context must import from here
 * instead of re-declaring lead minutes, limits, book_ticks.source strings, or WebView dims.
 *
 * @see docs/TENNIS_PROGRAM_ARCHETYPES.md
 */

/** Minutes before start_ts — tennis:live --lead and tennis:record --watch. */
export const TENNIS_DEFAULT_LEAD_MINUTES = 5;

/** Max events in watch-set (listWatchEvents / listRecordTickers). */
export const TENNIS_WATCH_LIMIT = 40;

/** Max HTML dashboard table rows (WebView layout). */
export const TENNIS_DASHBOARD_MAX_ROWS = 24;

/** book_ticks.source — Kalshi orderbook WebSocket recorder. */
export const KALSHI_BOOK_SOURCE_WS = "kalshi-ws" as const;

/** book_ticks.source — Kalshi REST /orderbook poller. */
export const KALSHI_BOOK_SOURCE_REST = "kalshi-rest" as const;

/** Prefer WS book when both exist (alpha + dashboard latest row). */
export const KALSHI_BOOK_SOURCE_PREFERENCE = [
  KALSHI_BOOK_SOURCE_WS,
  KALSHI_BOOK_SOURCE_REST,
] as const;

export type KalshiBookTickSource = (typeof KALSHI_BOOK_SOURCE_PREFERENCE)[number];

/** events.source / markets.source for Kalshi REST catalog sync. */
export const KALSHI_EVENT_SOURCE = "kalshi-api" as const;

/** live_scores.source / score_snapshots.source for /live_data poller. */
export const KALSHI_LIVE_SCORE_SOURCE = "kalshi-live-data" as const;

/** Headless Bun.WebView screenshot (tennis-ws-ground). */
export const TENNIS_WS_GROUND_WEBVIEW_WIDTH = 1280;
export const TENNIS_WS_GROUND_WEBVIEW_HEIGHT = 720;

/** Bun.Image thumb after WebView capture. */
export const TENNIS_WS_GROUND_THUMB_WIDTH = 480;
export const TENNIS_WS_GROUND_THUMB_HEIGHT = 270;
export const TENNIS_WS_GROUND_WEBP_QUALITY = 82;

/** Refresh watch-set membership during WS capture (kalshi-ws-recorder). */
export const TENNIS_WS_WATCH_REFRESH_MS = 30_000;

/** REST book poll loop default lives in env TENNIS_RECORD_INTERVAL_MS (record-cli) — not this constant. */

/** Hours after start_ts a non-live scheduled event stays on watch (listWatchEvents floor). */
export const TENNIS_WATCH_PAST_GRACE_HOURS = 6;

/** Clear is_live when live_scores.updated_ts is older than this (stuck in_progress). */
export const TENNIS_LIVE_STALE_MS = 45 * 60_000;

/** Default live_data poll interval (override with TENNIS_LIVE_INTERVAL_MS env). */
export const TENNIS_LIVE_INTERVAL_MS_DEFAULT = 10_000;

/** agent tennis: re-run canary when artifact older than this. */
export const TENNIS_CANARY_ARTIFACT_STALE_MS = 30 * 60_000;

/** agent tennis: refresh WS ground when artifact older than this. */
export const TENNIS_WS_GROUND_ARTIFACT_STALE_MS = 60 * 60_000;

/** OS Bun.cron — WS recorder (tools/tennis/ws-recorder-schedule-cli.ts). */
export const TENNIS_WS_RECORDER_CRON_SCHEDULE = "*/30 * * * *";
export const TENNIS_WS_RECORDER_DEFAULT_WS_SECONDS = 300;

/** OS Bun.cron — live_data dry-run canary (tools/tennis/live-canary-schedule-cli.ts). */
export const TENNIS_LIVE_CANARY_CRON_SCHEDULE = "*/15 * * * *";

/** agent tennis: re-run experiment check when artifact older than this. */
export const TENNIS_EXPERIMENT_ARTIFACT_STALE_MS = 24 * 60 * 60_000;

/** OS Bun.cron — factorial experiment dailyCheck (tools/tennis/experiment-schedule-cli.ts). */
export const TENNIS_EXPERIMENT_CRON_SCHEDULE = "0 9 * * *";

export function resolveTennisLeadMinutes(raw?: number): number {
  return Number.isFinite(raw) && (raw as number) > 0
    ? Math.floor(raw as number)
    : TENNIS_DEFAULT_LEAD_MINUTES;
}

export function resolveTennisWatchLimit(raw?: number): number {
  return Number.isFinite(raw) && (raw as number) > 0
    ? Math.floor(raw as number)
    : TENNIS_WATCH_LIMIT;
}
