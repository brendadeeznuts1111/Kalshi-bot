import { describe, expect, test } from "bun:test";
import {
  EXECUTION_LIFECYCLE_TITLE,
  EXECUTION_RECEIPTS_TITLE,
  EXECUTION_RECONCILE_TITLE,
  parseExecutionScheduleArgs,
} from "../../tools/partner-execution-schedule-cli.ts";

describe("partner execution worker schedule", () => {
  test("defaults both independent workers to every minute", () => {
    expect(parseExecutionScheduleArgs(["register"])).toEqual({
      command: "register",
      schedule: "* * * * *",
      count: 3,
    });
    expect(EXECUTION_RECONCILE_TITLE).not.toBe(EXECUTION_RECEIPTS_TITLE);
    expect(new Set([
      EXECUTION_RECONCILE_TITLE,
      EXECUTION_RECEIPTS_TITLE,
      EXECUTION_LIFECYCLE_TITLE,
    ]).size).toBe(3);
  });

  test("parses preview overrides and rejects unknown commands", () => {
    expect(parseExecutionScheduleArgs(["preview", "--schedule=*/2 * * * *", "--count=4"]))
      .toEqual({ command: "preview", schedule: "*/2 * * * *", count: 4 });
    expect(parseExecutionScheduleArgs(["start"])).toBeNull();
  });
});
