// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  parseScheduleCli,
  previewFireTimes,
  resolveSchedule,
  resolveTitle,
} from "../src/research/schedule-cli.ts";
import { RESEARCH_CRON_SCHEDULE, RESEARCH_CRON_TITLE } from "../src/research/constants.ts";

describe("schedule-cli", () => {
  test("parseScheduleCli accepts register/remove/preview", () => {
    expect(parseScheduleCli(["register"])?.command).toBe("register");
    expect(parseScheduleCli(["remove", "--title", "custom"])?.title).toBe("custom");
    expect(parseScheduleCli(["preview", "--count", "5"])?.count).toBe(5);
    expect(parseScheduleCli(["unknown"])).toBeNull();
  });

  test("defaults match constants", () => {
    expect(resolveSchedule()).toBe(RESEARCH_CRON_SCHEDULE);
    expect(resolveTitle()).toBe(RESEARCH_CRON_TITLE);
  });

  test("previewFireTimes returns ascending UTC dates", () => {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const times = previewFireTimes("@hourly", 3, base);
    expect(times).toHaveLength(3);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!.getTime()).toBeGreaterThan(times[i - 1]!.getTime());
    }
  });
});
