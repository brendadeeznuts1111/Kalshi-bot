// @see https://bun.com/docs/test — bun:test
import { describe, expect, test } from "bun:test";
import {
  capLastSeenAtMs,
  formatLastSeenDate,
  formatSurfacesDisplay,
  parseSurfaceStats,
  PROFILE_SQL,
  roundVolumeFp,
  SQL_EVENT_VOLUME_FP,
  SQL_MARKET_VOLUME_FP,
  SNAPSHOT_SQL,
} from "../../src/research/player-profile-meta.ts";

describe("player-profile-meta contract", () => {
  test("SQL column names are stable", () => {
    expect(PROFILE_SQL.avgKalshiVolumeFp).toBe("avg_kalshi_volume_fp");
    expect(PROFILE_SQL.lastSeenTs).toBe("last_seen_ts");
    expect(SNAPSHOT_SQL.kalshiVolume24h).toBe("kalshi_volume_24h");
    expect(SQL_MARKET_VOLUME_FP).toContain("volume_24h_fp");
    expect(SQL_MARKET_VOLUME_FP).toContain("volume_fp");
  });

  test("capLastSeenAtMs never returns future", () => {
    const now = 1_700_000_000_000;
    expect(capLastSeenAtMs(now + 86_400_000, now)).toBe(now);
    expect(capLastSeenAtMs(now - 1000, now)).toBe(now - 1000);
    expect(capLastSeenAtMs(null, now)).toBeNull();
    expect(capLastSeenAtMs(0, now)).toBeNull();
  });

  test("roundVolumeFp", () => {
    expect(roundVolumeFp(2016990.8900000001)).toBe(2016990.89);
    expect(roundVolumeFp(0)).toBeNull();
    expect(roundVolumeFp(null)).toBeNull();
  });

  test("formatLastSeenDate is UI-only ISO date", () => {
    expect(formatLastSeenDate(Date.UTC(2026, 6, 30))).toBe("2026-07-30");
  });

  test("parseSurfaceStats accepts nested and legacy counts", () => {
    const nested = parseSurfaceStats(JSON.stringify({ hard: { wins: 2, losses: 1, apps: 3 } }));
    expect(nested.hard).toEqual({ wins: 2, losses: 1, apps: 3 });
    const legacy = parseSurfaceStats(JSON.stringify({ clay: 4 }));
    expect(legacy.clay).toEqual({ apps: 4, wins: 0, losses: 0 });
    expect(formatSurfacesDisplay(nested)).toContain("hard 3 (2–1)");
  });

  test("SQL_EVENT_VOLUME_FP scopes match_winner", () => {
    expect(SQL_EVENT_VOLUME_FP).toContain("match_winner");
    expect(SQL_EVENT_VOLUME_FP).toContain("volume_24h_fp");
  });
});
