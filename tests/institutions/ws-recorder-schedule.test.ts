// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  parseWsRecorderScheduleCli,
  TENNIS_WS_RECORDER_CRON_SCHEDULE,
  TENNIS_WS_RECORDER_CRON_TITLE,
  TENNIS_WS_RECORDER_DEFAULT_WS_SECONDS,
  resolveWsRecorderWsSeconds,
} from "../../tools/tennis/ws-recorder-schedule-cli.ts";

describe("ws-recorder-schedule-cli", () => {
  test("parseWsRecorderScheduleCli accepts register/remove/preview", () => {
    expect(parseWsRecorderScheduleCli(["register"])?.command).toBe("register");
    expect(parseWsRecorderScheduleCli(["remove", "--title", "custom"])?.title).toBe("custom");
    expect(parseWsRecorderScheduleCli(["preview", "--count", "5"])?.count).toBe(5);
    expect(parseWsRecorderScheduleCli(["unknown"])).toBeNull();
  });

  test("defaults match constants", () => {
    expect(parseWsRecorderScheduleCli(["register"])?.schedule).toBe(TENNIS_WS_RECORDER_CRON_SCHEDULE);
    expect(parseWsRecorderScheduleCli(["register"])?.title).toBe(TENNIS_WS_RECORDER_CRON_TITLE);
    expect(parseWsRecorderScheduleCli(["register"])?.wsSeconds).toBe(TENNIS_WS_RECORDER_DEFAULT_WS_SECONDS);
  });

  test("resolveWsRecorderWsSeconds honors override", () => {
    expect(resolveWsRecorderWsSeconds("120")).toBe(120);
    expect(resolveWsRecorderWsSeconds("bad")).toBe(TENNIS_WS_RECORDER_DEFAULT_WS_SECONDS);
  });

  test("parseWsRecorderScheduleCli accepts --ws-seconds", () => {
    expect(parseWsRecorderScheduleCli(["preview", "--ws-seconds", "180"])?.wsSeconds).toBe(180);
  });
});
