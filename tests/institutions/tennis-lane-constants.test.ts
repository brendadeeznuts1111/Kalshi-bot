// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  KALSHI_BOOK_SOURCE_PREFERENCE,
  KALSHI_BOOK_SOURCE_REST,
  KALSHI_BOOK_SOURCE_WS,
  KALSHI_EVENT_SOURCE,
  KALSHI_LIVE_SCORE_SOURCE,
  resolveTennisLeadMinutes,
  resolveTennisWatchLimit,
  TENNIS_DASHBOARD_MAX_ROWS,
  TENNIS_DEFAULT_LEAD_MINUTES,
  TENNIS_WATCH_LIMIT,
  TENNIS_WS_GROUND_WEBVIEW_WIDTH,
} from "../../src/institutions/event-store/tennis-lane-constants.ts";

describe("tennis-lane-constants", () => {
  test("wire tokens are stable and distinct", () => {
    const tokens = new Set([
      KALSHI_BOOK_SOURCE_WS,
      KALSHI_BOOK_SOURCE_REST,
      KALSHI_EVENT_SOURCE,
      KALSHI_LIVE_SCORE_SOURCE,
    ]);
    expect(tokens.size).toBe(4);
    expect(KALSHI_BOOK_SOURCE_PREFERENCE).toEqual([KALSHI_BOOK_SOURCE_WS, KALSHI_BOOK_SOURCE_REST]);
  });

  test("resolve helpers fall back to SSOT defaults", () => {
    expect(resolveTennisLeadMinutes()).toBe(TENNIS_DEFAULT_LEAD_MINUTES);
    expect(resolveTennisWatchLimit()).toBe(TENNIS_WATCH_LIMIT);
    expect(resolveTennisLeadMinutes(0)).toBe(TENNIS_DEFAULT_LEAD_MINUTES);
    expect(resolveTennisWatchLimit(-1)).toBe(TENNIS_WATCH_LIMIT);
    expect(resolveTennisLeadMinutes(12)).toBe(12);
  });

  test("dashboard row cap is less than watch limit", () => {
    expect(TENNIS_DASHBOARD_MAX_ROWS).toBeLessThanOrEqual(TENNIS_WATCH_LIMIT);
    expect(TENNIS_WS_GROUND_WEBVIEW_WIDTH).toBeGreaterThan(0);
  });
});
