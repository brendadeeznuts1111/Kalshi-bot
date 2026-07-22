// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  createPhaseTimer,
  formatDurationMs,
  formatPhaseTimings,
  phaseTimingTableRows,
} from "../src/research/phase-timing.ts";

describe("phase-timing", () => {
  test("formatDurationMs chooses ms vs seconds", () => {
    expect(formatDurationMs(12)).toBe("12ms");
    expect(formatDurationMs(3200)).toBe("3.2s");
  });

  test("createPhaseTimer records wall-clock ms", async () => {
    const timer = createPhaseTimer();
    timer.start("discover");
    await Bun.sleep(5);
    timer.end("discover");
    timer.start("gate");
    timer.end("gate");
    const snap = timer.snapshot();
    expect(snap.discover).toBeGreaterThanOrEqual(1);
    expect(snap.gate).toBeGreaterThanOrEqual(0);
    expect(formatPhaseTimings(snap)).toMatch(/^Timing: discover .+ms, gate /);
  });

  test("phaseTimingTableRows builds inspect.table rows", () => {
    expect(phaseTimingTableRows({ discover: 120, gate: 30 })).toEqual([
      { phase: "discover", duration: "120ms" },
      { phase: "gate", duration: "30ms" },
      { phase: "total", duration: "150ms" },
    ]);
  });
});
